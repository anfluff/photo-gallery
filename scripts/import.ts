// Imports photos into the gallery.
//
//   npm run import -- <zip or folder>
//
// For each photo it writes a full-size and a thumbnail WebP into public/photos
// and adds the photo to src/gallery.json. Photos that are already imported keep
// their place on the mesh and new ones join its outer edge, so the script is
// safe to re-run with a newer download.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { addPhotos, emptyGallery, serializeGallery, type Gallery, type Photo } from '../src/layout.ts';

const FULL_EDGE = 2000;
// A cell is at most 240 by 360 CSS pixels and the photo is cropped to fill it,
// so the thumbnail has to cover twice that for sharp display on a 2x screen.
const THUMB_COVER = { width: 480, height: 720 };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const galleryFile = path.join(root, 'src/gallery.json');
const fullDir = path.join(root, 'public/photos/full');
const thumbDir = path.join(root, 'public/photos/thumb');
const cacheDir = path.join(root, '.import-cache');

const IMAGE = /\.(jpe?g|png|webp|gif|avif|tiff?|heic|heif)$/i;
const HEIC = /\.(heic|heif)$/i;
// Files from scripts/gphotos-fetch.js are named <date>-<time>_<Google Photos id>.<ext>.
const GOOGLE_NAME = /^\d{8}-\d{6}_(.+)\.[a-z0-9]+$/i;
const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_/;

type Status = 'added' | 'restored' | 'skipped' | 'removed';
interface Result {
  id: string;
  photo: Photo;
  status: Status;
}

const sha1 = (data: string | Buffer): string => createHash('sha1').update(data).digest('hex');

/**
 * A short public id for a photo. Files from Google Photos are identified by
 * their Google id, anything else by its contents. The Google id itself never
 * reaches the site.
 */
async function photoId(file: string): Promise<string> {
  const google = GOOGLE_NAME.exec(path.basename(file));
  const key = google ? `gphotos:${google[1]}` : `sha1:${sha1(await fs.readFile(file))}`;
  return sha1(key).slice(0, 12);
}

/**
 * When the photo was taken, like 2026-11-12T15:12:31. Files from Google Photos
 * carry it in their name. For other files the time the file was last changed
 * stands in.
 */
async function takenAt(file: string): Promise<string> {
  const stamp = STAMP.exec(path.basename(file));
  if (stamp) return `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}`;
  const { mtime } = await fs.stat(file);
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    `${mtime.getFullYear()}-${two(mtime.getMonth() + 1)}-${two(mtime.getDate())}` +
    `T${two(mtime.getHours())}:${two(mtime.getMinutes())}:${two(mtime.getSeconds())}`
  );
}

async function listImages(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && IMAGE.test(e.name) && !e.name.startsWith('.'))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();

  // A manifest from gphotos-fetch.js lists the photos in album order, newest first.
  const manifestFile = path.join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) return files;
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as { file: string }[];
  const rank = new Map(manifest.map((m, i) => [m.file, i]));
  const at = (f: string) => rank.get(path.basename(f)) ?? Number.MAX_SAFE_INTEGER;
  return files.sort((a, b) => at(a) - at(b));
}

async function processOne(file: string, gallery: Gallery): Promise<Result> {
  const id = await photoId(file);
  const full = path.join(fullDir, `${id}.webp`);
  const thumb = path.join(thumbDir, `${id}.webp`);
  // Photos removed in admin mode stay out, even when the download still has them.
  if (gallery.removed?.includes(id)) return { id, photo: { w: 0, h: 0 }, status: 'removed' };
  const known = Object.hasOwn(gallery.photos, id) ? gallery.photos[id] : null;
  const t = known?.t ?? (await takenAt(file));
  if (known && existsSync(full) && existsSync(thumb)) return { id, photo: { ...known, t }, status: 'skipped' };

  // sharp cannot decode HEIC, so macOS converts those to JPEG first.
  let input = file;
  let temp: string | null = null;
  if (HEIC.test(file)) {
    if (process.platform !== 'darwin') throw new Error('HEIC files need macOS (sips) to convert');
    temp = path.join(cacheDir, `${id}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', temp], { stdio: 'ignore' });
    input = temp;
  }

  try {
    // rotate() applies the EXIF orientation. sharp drops all other metadata,
    // GPS position included, unless told to keep it.
    const image = sharp(input, { failOn: 'none' }).rotate();
    const info = await image
      .clone()
      .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(full);
    await image
      .clone()
      .resize({ ...THUMB_COVER, fit: 'outside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(thumb);
    return { id, photo: { ...known, w: info.width, h: info.height, t }, status: known ? 'restored' : 'added' };
  } finally {
    if (temp) await fs.rm(temp, { force: true });
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npm run import -- <zip or folder of photos>');
    process.exit(1);
  }
  const source = path.resolve(arg);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) {
    console.error(`Not found: ${source}`);
    process.exit(1);
  }

  await Promise.all([fullDir, thumbDir, cacheDir].map((d) => fs.mkdir(d, { recursive: true })));

  let dir = source;
  let extracted: string | null = null;
  if (stat.isFile()) {
    if (!/\.zip$/i.test(source)) {
      console.error('The source must be a .zip file or a folder.');
      process.exit(1);
    }
    extracted = await fs.mkdtemp(path.join(cacheDir, 'zip-'));
    console.log('Extracting the zip...');
    execFileSync('unzip', ['-q', '-o', source, '-d', extracted], { stdio: 'inherit' });
    dir = extracted;
  }

  try {
    const gallery: Gallery = existsSync(galleryFile)
      ? (JSON.parse(await fs.readFile(galleryFile, 'utf8')) as Gallery)
      : emptyGallery();
    const files = await listImages(dir);
    console.log(`Found ${files.length} image files.`);

    const results: (Result | null)[] = new Array(files.length).fill(null);
    const failures: string[] = [];
    let next = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const i = next++;
        try {
          results[i] = await processOne(files[i], gallery);
        } catch (err) {
          failures.push(`${path.basename(files[i])}: ${err instanceof Error ? err.message : String(err)}`);
        }
        done++;
        if (done % 100 === 0 || done === files.length) console.log(`  ${done} of ${files.length}`);
      }
    };
    const workers = Math.min(8, os.availableParallelism());
    await Promise.all(Array.from({ length: workers }, worker));

    // Results stay in file order, so new photos join the mesh in album order.
    const added: Record<string, Photo> = {};
    const count: Record<Status, number> = { added: 0, restored: 0, skipped: 0, removed: 0 };
    for (const r of results) {
      if (!r || Object.hasOwn(added, r.id)) continue;
      count[r.status]++;
      if (r.status !== 'removed') added[r.id] = r.photo;
    }
    const updated = addPhotos(gallery, added);
    await fs.writeFile(galleryFile, serializeGallery(updated));

    console.log(
      `Added ${count.added}, skipped ${count.skipped} already imported, ` +
        `rebuilt files for ${count.restored}, left out ${count.removed} removed in admin mode, ` +
        `failed ${failures.length}.`,
    );
    console.log(`The gallery has ${updated.order.length} photos.`);
    if (failures.length) {
      console.error('Failed files:');
      for (const f of failures) console.error(`  ${f}`);
      process.exitCode = 1;
    }
  } finally {
    if (extracted) await fs.rm(extracted, { recursive: true, force: true });
  }
}

await main();
