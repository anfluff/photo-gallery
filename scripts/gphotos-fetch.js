// Downloads every photo in your Google Photos favourites as one zip.
//
// Google has no API that reads the favourites album, so this runs inside the
// Google Photos page with the session you are already logged in to.
//
// How to use it:
//   1. Open Google Photos in Chrome and go to your Favourites album.
//   2. Open DevTools (Cmd+Option+J), paste this whole file into the console, press Enter.
//   3. Wait for "gphotos-favorites.zip" to land in Downloads. Progress prints in the console.
//   4. Run: npm run import -- ~/Downloads/gphotos-favorites.zip
//
// It scrolls the page to index every item, fetches each photo at up to
// EDGE pixels on its long side, and skips videos. Files are named
// <date>-<time>_<Google Photos id>.jpg, and the import script uses that id to
// skip photos it already has. The page markup is Google's and can change. If
// the script stops finding photos, the selectors in collect() need updating.

(async () => {
  const EDGE = 2400;
  const PARALLEL = 6;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');

  // Step 1: scroll through the album. The page only keeps visible items in the
  // DOM, so each one has to be read while it is on screen.
  async function collect() {
    const scroller = [...document.querySelectorAll('c-wiz')].find(
      (el) => el.scrollHeight > el.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(el).overflowY),
    );
    if (!scroller) throw new Error('Could not find the scrolling photo list on this page.');
    const items = new Map();
    const grab = () => {
      let pending = 0;
      for (const a of document.querySelectorAll('a[href*="/photo/"]')) {
        const id = a.getAttribute('href').split('/photo/')[1].split(/[?#/]/)[0];
        if (items.get(id)?.base) continue;
        const tile = [...a.querySelectorAll('*')].find((el) => getComputedStyle(el).backgroundImage.includes('usercontent'));
        const url = tile && getComputedStyle(tile).backgroundImage.match(/url\("([^"]+)"\)/);
        const base = url ? url[1].split('=')[0] : null;
        const box = a.getBoundingClientRect();
        if (!base && box.bottom > 0 && box.top < innerHeight) pending++;
        items.set(id, { id, base, label: a.getAttribute('aria-label') || '', order: items.get(id)?.order ?? items.size });
      }
      return pending;
    };
    scroller.scrollTop = 0;
    await sleep(800);
    let stuck = 0;
    let last = -1;
    while (stuck < 4) {
      for (let tries = 0; tries < 8 && grab() > 0; tries++) await sleep(250);
      scroller.scrollTop += scroller.clientHeight * 0.7;
      await sleep(350);
      stuck = scroller.scrollTop === last ? stuck + 1 : 0;
      last = scroller.scrollTop;
    }
    grab();
    return [...items.values()].sort((a, b) => a.order - b.order);
  }

  // Step 2: fetch the image bytes. The photo host needs the session cookies.
  async function fetchAll(photos) {
    const failed = [];
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < photos.length) {
        const item = photos[next++];
        for (let attempt = 0; attempt < 4 && !item.blob; attempt++) {
          try {
            const res = await fetch(`${item.base}=w${EDGE}-h${EDGE}`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            if (!blob.type.startsWith('image/') || blob.size < 2000) throw new Error(`unexpected response ${blob.type}`);
            item.blob = blob;
          } catch (err) {
            item.error = String(err);
            await sleep(800 * (attempt + 1));
          }
        }
        if (!item.blob) failed.push(item);
        if (++done % 100 === 0) console.log(`Fetched ${done} of ${photos.length}`);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return failed;
  }

  // Step 3: pack everything into an uncompressed zip. JPEGs do not compress further.
  async function zip(photos) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    const crc32 = (bytes) => {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    let count = 0;
    const add = (name, blob, bytes, date) => {
      const nameBytes = encoder.encode(name);
      const crc = crc32(bytes);
      const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
      const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(local.buffer, nameBytes, blob);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, day, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, bytes.length, true);
      entry.setUint32(24, bytes.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry.buffer, nameBytes);
      offset += 30 + nameBytes.length + bytes.length;
      count++;
    };

    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const manifest = [];
    for (const item of photos) {
      // The label reads like "Photo - Portrait - Nov 12, 2026, 3:12:31 PM - Favorited".
      const bits = item.label.replace(/[  ]/g, ' ').split(' - ');
      const taken = bits.map((b) => (/\d{4}/.test(b) ? Date.parse(b) : NaN)).find((t) => !Number.isNaN(t));
      const date = taken === undefined ? new Date(2000, 0, 1) : new Date(taken);
      const stamp =
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
      const file = `${stamp}_${item.id}.${extensions[item.blob.type] || 'jpg'}`;
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      add(file, item.blob, bytes, date);
      manifest.push({ id: item.id, file, label: item.label, bytes: bytes.length });
    }
    const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 1));
    add('manifest.json', new Blob([manifestBytes]), manifestBytes, new Date());

    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  console.log('Indexing the album. The page will scroll on its own.');
  const items = await collect();
  const photos = items.filter((item) => item.base && !/^video/i.test(item.label));
  console.log(`Found ${items.length} items, ${photos.length} of them photos. Fetching.`);
  const failed = await fetchAll(photos);
  if (failed.length) console.warn(`${failed.length} photos failed and are left out:`, failed.map((f) => f.error));
  const archive = await zip(photos.filter((item) => item.blob));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(archive);
  link.download = 'gphotos-favorites.zip';
  document.body.append(link);
  link.click();
  console.log(`Done. gphotos-favorites.zip is ${Math.round(archive.size / 1e6)} MB with ${photos.length - failed.length} photos.`);
})();
