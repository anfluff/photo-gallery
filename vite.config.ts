import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { applyEdit, isColor, serializeGallery, setLikes, type Edit, type Gallery } from './src/layout.ts';

const galleryFile = fileURLToPath(new URL('./src/gallery.json', import.meta.url));
const photoDir = fileURLToPath(new URL('./public/photos', import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk;
      if (body.length > 5_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Lets admin mode save its changes. It exists only in the dev server.
 * POST /api/gallery with { order, removed, size, gap, radius, hover, background } rewrites src/gallery.json and
 * deletes the image files of removed photos. POST /api/like with { id, likes }
 * sets how much one photo is liked.
 */
function adminApi(): Plugin {
  // Changes run one after another, so two of them never read the same file and overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  /** Answers a POST by changing the gallery file. `change` returns the new gallery, or a reason to refuse. */
  const endpoint =
    (change: (gallery: Gallery, body: unknown) => Gallery | string) =>
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const reply = (status: number, body: object): void => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      // Only the gallery page itself may save. This rejects posts from other sites.
      const origin = req.headers.origin;
      const sameOrigin = !origin || new URL(origin).host === req.headers.host;
      const json = (req.headers['content-type'] ?? '').startsWith('application/json');
      if (req.method !== 'POST' || !sameOrigin || !json) return reply(403, { error: 'not allowed' });
      try {
        const body = JSON.parse(await readBody(req)) as unknown;
        await inTurn(async () => {
          const gallery = JSON.parse(await fs.readFile(galleryFile, 'utf8')) as Gallery;
          const updated = change(gallery, body);
          if (typeof updated === 'string') return reply(400, { error: updated });
          await fs.writeFile(galleryFile, serializeGallery(updated));
          // The change has checked that every photo it drops is a photo of this gallery.
          const removed = Object.keys(gallery.photos).filter((id) => !Object.hasOwn(updated.photos, id));
          for (const id of removed) {
            await fs.rm(`${photoDir}/full/${id}.webp`, { force: true });
            await fs.rm(`${photoDir}/thumb/${id}.webp`, { force: true });
          }
          reply(200, { ok: true, removed: removed.length });
        });
      } catch (err) {
        reply(500, { error: err instanceof Error ? err.message : String(err) });
      }
    };

  return {
    name: 'gallery-admin-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/gallery', endpoint((gallery, body) => applyEdit(gallery, body as Edit)));
      server.middlewares.use(
        '/api/like',
        endpoint((gallery, body) => {
          const { id, likes } = (body ?? {}) as { id?: unknown; likes?: unknown };
          return setLikes(gallery, id, likes);
        }),
      );
    },
    // A save must not reload the page the admin is working in.
    handleHotUpdate({ file }) {
      if (file === galleryFile) return [];
    },
  };
}

/**
 * Writes the background colour of the gallery file into the page itself, so
 * the page has it from its first frame and not only once the script has run.
 */
function pageColour(): Plugin {
  return {
    name: 'gallery-page-colour',
    async transformIndexHtml(html) {
      const { background } = JSON.parse(await fs.readFile(galleryFile, 'utf8')) as Gallery;
      if (!isColor(background)) return html;
      return {
        html: html.replace(/(<meta name="theme-color" content=")[^"]*/, `$1${background}`),
        tags: [{ tag: 'style', children: `:root { --bg: ${background}; }`, injectTo: 'head' }],
      };
    },
  };
}

export default defineConfig({
  plugins: [adminApi(), pageColour()],
});
