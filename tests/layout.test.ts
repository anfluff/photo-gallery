import { describe, expect, it } from 'vitest';
import {
  addPhotos,
  applyEdit,
  byLikes,
  byTime,
  closeGaps,
  emptyGallery,
  layOut,
  layOutList,
  nextFilled,
  serializeGallery,
  setLikes,
  validateOrder,
  type Gallery,
  type Photo,
} from '../src/layout.ts';
import { cellIndex } from '../src/torus.ts';

const photo: Photo = { w: 1200, h: 1800 };
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i}`);
const gallery = (n: number, extra: Partial<Gallery> = {}): Gallery => ({
  photos: Object.fromEntries(ids(n).map((id) => [id, photo])),
  order: ids(n),
  ...extra,
});

describe('addPhotos', () => {
  it('puts the first photos in the order they came', () => {
    const g = addPhotos(emptyGallery(), { a: photo, b: photo, c: photo });
    expect(g.order).toEqual(['a', 'b', 'c']);
    expect(Object.keys(g.photos)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the photos it has in place and adds new ones at the end', () => {
    const g = addPhotos(gallery(3, { order: ['p2', 'p0', 'p1'] }), { p1: photo, x: photo, y: photo });
    expect(g.order).toEqual(['p2', 'p0', 'p1', 'x', 'y']);
  });

  it('updates the size of a photo it already has', () => {
    const g = addPhotos(gallery(2), { p1: { w: 10, h: 20 } });
    expect(g.photos.p1).toEqual({ w: 10, h: 20 });
    expect(g.order).toEqual(['p0', 'p1']);
  });

  it('keeps the other fields', () => {
    const g = addPhotos(gallery(2, { gap: 0.1, removed: ['gone'] }), { x: photo });
    expect(g.gap).toBe(0.1);
    expect(g.removed).toEqual(['gone']);
  });
});

describe('byLikes', () => {
  const photos: Record<string, Photo> = {
    p0: photo,
    p1: { ...photo, likes: 1 },
    p2: { ...photo, likes: 3 },
    p3: photo,
    p4: { ...photo, likes: 2 },
    p5: { ...photo, likes: 3 },
  };

  it('changes nothing without likes', () => {
    expect(byLikes(ids(5), gallery(5).photos)).toEqual(ids(5));
  });

  it('puts the photos with more likes first, and keeps the order of photos with the same likes', () => {
    expect(byLikes(ids(6), photos)).toEqual(['p2', 'p5', 'p4', 'p1', 'p0', 'p3']);
    expect(byLikes(['p5', 'p3', 'p2', 'p0'], photos)).toEqual(['p5', 'p2', 'p3', 'p0']);
  });

  it('leaves the list it was given alone', () => {
    const order = ids(6);
    byLikes(order, photos);
    expect(order).toEqual(ids(6));
  });
});

describe('layOut', () => {
  it('fills every cell, whatever the number of photos', () => {
    for (const n of [1, 2, 7, 13, 97, 1341]) {
      const layout = layOut(ids(n));
      expect(layout.cells).toHaveLength(n);
      expect(layout.cells.includes(null)).toBe(false);
      expect([...layout.cells].sort()).toEqual(ids(n).sort());
    }
  });

  it('puts the first photo in the middle and the next ones around it', () => {
    const layout = layOut(ids(200));
    const at = (col: number, row: number): string | null => layout.cells[cellIndex(col, row, layout.cols, 200)];
    expect(at(0, 0)).toBe('p0');
    expect([at(-1, 0), at(1, 0)].sort()).toEqual(['p1', 'p2']);
    expect([at(0, -1), at(0, 1)].sort()).toEqual(['p3', 'p4']);
  });

  it('gathers the most liked photos in the middle', () => {
    const photos = Object.fromEntries(ids(200).map((id) => [id, { ...photo }]));
    photos.p150.likes = 3;
    photos.p60.likes = 2;
    photos.p199.likes = 2;
    photos.p7.likes = 1;
    const layout = layOut(byLikes(ids(200), photos));
    const at = (col: number, row: number): string | null => layout.cells[cellIndex(col, row, layout.cols, 200)];
    expect(at(0, 0)).toBe('p150');
    expect([at(-1, 0), at(1, 0)].sort()).toEqual(['p199', 'p60']);
    expect([at(0, -1), at(0, 1)]).toContain('p7');
  });

  it('closes the gap when a photo is left out of the order', () => {
    const before = layOut(ids(50));
    const after = layOut(ids(50).filter((id) => id !== 'p20'));
    expect(after.cells).toHaveLength(49);
    expect(after.cells.includes(null)).toBe(false);
    // The photos nearer the middle than the one left out stay where they were.
    const at = (layout: typeof before, col: number, row: number): string | null =>
      layout.cells[cellIndex(col, row, layout.cols, layout.cells.length)];
    for (const [col, row] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(at(after, col, row)).toBe(at(before, col, row));
    }
  });

  it('gives back an empty layout for no photos', () => {
    expect(layOut([]).cells).toEqual([]);
  });
});

describe('closeGaps', () => {
  /** The photo in a cell of the mesh that an order makes. */
  const reader = (order: string[]) => {
    const layout = layOut(order);
    return (col: number, row: number): string | null => layout.cells[cellIndex(col, row, layout.cols, order.length)];
  };
  /** The cells near the middle, where the mesh does not repeat yet. */
  const near: [number, number][] = [];
  for (let row = -3; row <= 3; row++) for (let col = -5; col <= 5; col++) near.push([col, row]);

  it('lets the rest of a row step towards the middle and keeps the other photos in place', () => {
    const order = ids(300);
    const before = reader(order);
    const after = reader(closeGaps(order, new Set([before(2, 1)!, before(-3, -2)!]), {}));
    for (const [col, row] of near) {
      // Right of the first gap the row steps left, and left of the second gap the row steps right.
      const from = row === 1 && col >= 2 ? col + 1 : row === -2 && col <= -3 ? col - 1 : col;
      expect(after(col, row), `cell ${col},${row}`).toBe(before(from, row));
    }
  });

  it('fills the middle cell from the right', () => {
    const order = ids(300);
    const before = reader(order);
    const after = reader(closeGaps(order, new Set([before(0, 0)!]), {}));
    expect(after(0, 0)).toBe(before(1, 0));
    expect(after(1, 0)).toBe(before(2, 0));
    expect(after(-1, 0)).toBe(before(-1, 0));
    expect(after(0, 1)).toBe(before(0, 1));
  });

  it('keeps every other photo once', () => {
    for (const count of [2, 3, 10, 57, 300]) {
      const order = ids(count);
      const gone = new Set(order.filter((_, i) => i % 7 === 3));
      const out = closeGaps(order, gone, {});
      expect([...out].sort()).toEqual(order.filter((id) => !gone.has(id)).sort());
    }
    expect(closeGaps(ids(4), new Set(ids(4)), {})).toEqual([]);
  });

  it('gives back the same order when nothing is removed', () => {
    const order = ['p3', 'p1', 'p0', 'p2'];
    expect(closeGaps(order, new Set(), {})).toEqual(order);
  });

  it('keeps the most liked photos in the middle', () => {
    const photos: Record<string, Photo> = Object.fromEntries(ids(300).map((id) => [id, { ...photo }]));
    ids(300).forEach((id, i) => {
      if (i % 5 === 0) photos[id].likes = 3;
      else if (i % 5 === 1) photos[id].likes = 2;
      else if (i % 5 === 2) photos[id].likes = 1;
    });
    const order = byLikes(ids(300), photos);
    const before = reader(order);
    // One photo of each number of likes, and one without any.
    const gone = new Set([order[3], order[70], order[130], order[250]]);
    const out = closeGaps(order, gone, photos);
    expect(byLikes(out, photos)).toEqual(out);
    // Few photos leave their cell: the rest of each row with a gap, and the ones that jump.
    const after = reader(out);
    const moved = near.filter(([col, row]) => after(col, row) !== before(col, row));
    expect(moved.length).toBeLessThan(20);
  });

  it('moves a photo to the area of its likes when the order is not sorted', () => {
    const photos: Record<string, Photo> = Object.fromEntries(ids(100).map((id) => [id, { ...photo }]));
    photos.p90.likes = 3;
    const out = closeGaps(ids(100), new Set(['p50']), photos);
    expect(out[0]).toBe('p90');
    expect([...out].sort()).toEqual(ids(100).filter((id) => id !== 'p50').sort());
  });
});

describe('byTime', () => {
  const photos = {
    a: { w: 1, h: 1, t: '2026-03-01T10:00:00' },
    b: { w: 1, h: 1, t: '2024-12-31T23:59:59' },
    c: { w: 1, h: 1 },
    d: { w: 1, h: 1, t: '2026-03-01T09:59:59' },
    e: { w: 1, h: 1, t: '2026-03-01T10:00:00' },
  };

  it('puts the oldest photo first', () => {
    expect(byTime(photos, ['a', 'b', 'd'])).toEqual(['b', 'd', 'a']);
  });

  it('puts photos without a date last', () => {
    expect(byTime(photos, ['c', 'a', 'b'])).toEqual(['b', 'a', 'c']);
  });

  it('keeps the given order for photos taken at the same time', () => {
    expect(byTime(photos, ['e', 'a'])).toEqual(['e', 'a']);
    expect(byTime(photos, ['a', 'e'])).toEqual(['a', 'e']);
  });

  it('leaves the list it was given alone', () => {
    const ids = ['a', 'b'];
    byTime(photos, ids);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('layOutList', () => {
  it('keeps the photos in the order given, as a grid that ends', () => {
    const layout = layOutList(ids(97));
    expect(layout.cells).toEqual(ids(97));
    expect(layout.bounded).toBe(true);
  });
});

describe('nextFilled', () => {
  // A strip of 10 photos in rows of 4.
  const layout = { cols: 4, cells: ids(10) as (string | null)[] };

  it('steps to the next cell along a row and along a column', () => {
    expect(nextFilled(layout, 0, 1, 0)).toEqual({ index: 1, steps: 1 });
    expect(nextFilled(layout, 0, 0, 1)).toEqual({ index: 4, steps: 1 });
    expect(nextFilled(layout, 5, -1, 0)).toEqual({ index: 4, steps: 1 });
    expect(nextFilled(layout, 5, 0, -1)).toEqual({ index: 1, steps: 1 });
  });

  it('carries on past the end of the strip', () => {
    expect(nextFilled(layout, 9, 1, 0)).toEqual({ index: 0, steps: 1 });
    expect(nextFilled(layout, 0, -1, 0)).toEqual({ index: 9, steps: 1 });
    expect(nextFilled(layout, 8, 0, 1)).toEqual({ index: 2, steps: 1 });
  });

  it('skips the cells of removed photos', () => {
    const holed = { cols: 4, cells: layout.cells.map((id, i) => (i === 1 || i === 2 ? null : id)) };
    expect(nextFilled(holed, 0, 1, 0)).toEqual({ index: 3, steps: 3 });
  });

  it('returns null when no other photo lies that way', () => {
    const alone = { cols: 4, cells: layout.cells.map((id, i) => (i === 0 ? id : null)) };
    expect(nextFilled(alone, 0, 1, 0)).toBeNull();
    // Going down from cell 0 in rows of 5 only ever meets cells 0 and 5.
    const column = { cols: 5, cells: ids(10).map((id, i) => (i === 5 ? null : id)) };
    expect(nextFilled(column, 0, 0, 1)).toBeNull();
  });
});

describe('nextFilled in a grid that ends', () => {
  // 10 photos in rows of 4: the last row holds two.
  const layout = { cols: 4, cells: ids(10) as (string | null)[], bounded: true };

  it('steps along a row and along a column', () => {
    expect(nextFilled(layout, 1, 1, 0)).toEqual({ index: 2, steps: 1 });
    expect(nextFilled(layout, 1, 0, 1)).toEqual({ index: 5, steps: 1 });
    expect(nextFilled(layout, 5, 0, -1)).toEqual({ index: 1, steps: 1 });
  });

  it('carries on in the next row at the end of a row', () => {
    expect(nextFilled(layout, 3, 1, 0)).toEqual({ index: 4, steps: 1 });
    expect(nextFilled(layout, 4, -1, 0)).toEqual({ index: 3, steps: 1 });
  });

  it('stops at the first and the last photo, and at the top and bottom rows', () => {
    expect(nextFilled(layout, 9, 1, 0)).toBeNull();
    expect(nextFilled(layout, 0, -1, 0)).toBeNull();
    expect(nextFilled(layout, 2, 0, -1)).toBeNull();
    expect(nextFilled(layout, 6, 0, 1)).toBeNull();
  });

  it('skips the cells of removed photos', () => {
    const holed = { ...layout, cells: layout.cells.map((id, i) => (i === 5 ? null : id)) };
    expect(nextFilled(holed, 4, 1, 0)).toEqual({ index: 6, steps: 2 });
    expect(nextFilled(holed, 1, 0, 1)).toEqual({ index: 9, steps: 2 });
  });
});

describe('validateOrder', () => {
  const g = gallery(4);

  it('accepts every photo once, in any order', () => {
    expect(validateOrder(g, ['p3', 'p1', 'p0', 'p2'])).toBeNull();
  });

  it('rejects something that is not a list', () => {
    expect(validateOrder(g, 'p0')).toMatch(/list/);
  });

  it('rejects an unknown photo, and an entry that is not a photo id', () => {
    expect(validateOrder(g, ['p0', 'p1', 'p2', 'nope'])).toMatch(/unknown photo/);
    expect(validateOrder(g, ['p0', 'p1', 'p2', null])).toMatch(/unknown photo/);
    expect(validateOrder(g, ['p0', 'p1', 'p2', 'toString'])).toMatch(/unknown photo/);
  });

  it('rejects a photo that is placed twice or missing', () => {
    expect(validateOrder(g, ['p0', 'p1', 'p2', 'p2'])).toMatch(/twice/);
    expect(validateOrder(g, ['p0', 'p1', 'p2'])).toMatch(/missing/);
  });

  it('wants removed photos left out', () => {
    expect(validateOrder(g, ['p0', 'p1', 'p2'], ['p3'])).toBeNull();
    expect(validateOrder(g, ['p0', 'p1', 'p2', 'p3'], ['p3'])).toMatch(/removed/);
  });
});

describe('applyEdit', () => {
  const g = gallery(4, { gap: 0.2, removed: ['old'] });
  g.photos.p1 = { ...photo, likes: 2 };

  it('takes the new order', () => {
    const out = applyEdit(g, { order: ['p3', 'p2', 'p1', 'p0'] }) as Gallery;
    expect(out.order).toEqual(['p3', 'p2', 'p1', 'p0']);
    expect(out.gap).toBe(0.2);
    expect(out.photos.p1.likes).toBe(2);
    expect(out.removed).toEqual(['old']);
  });

  it('drops removed photos and remembers them', () => {
    const out = applyEdit(g, { order: ['p0', 'p1', 'p2'], removed: ['p3'] }) as Gallery;
    expect(Object.keys(out.photos)).toEqual(['p0', 'p1', 'p2']);
    expect(out.removed).toEqual(['old', 'p3']);
  });

  it('takes a new size, keeps the old one when none is sent, and refuses one out of range', () => {
    const large = applyEdit(g, { order: g.order, size: 1.5 }) as Gallery;
    expect(large.size).toBe(1.5);
    expect((applyEdit(large, { order: g.order, gap: 0.3 }) as Gallery).size).toBe(1.5);
    expect(applyEdit(g, { order: g.order, size: 0.4 })).toMatch(/size/);
    expect(applyEdit(g, { order: g.order, size: 2.1 })).toMatch(/size/);
    expect(applyEdit(g, { order: g.order, size: '1' })).toMatch(/size/);
  });

  it('takes a new gap and refuses one out of range', () => {
    expect((applyEdit(g, { order: g.order, gap: 0.5 }) as Gallery).gap).toBe(0.5);
    expect(applyEdit(g, { order: g.order, gap: -1 })).toMatch(/gap/);
    expect(applyEdit(g, { order: g.order, gap: '0.5' })).toMatch(/gap/);
  });

  it('takes a new radius, keeps the old one when none is sent, and refuses one out of range', () => {
    const round = applyEdit(g, { order: g.order, radius: 0.12 }) as Gallery;
    expect(round.radius).toBe(0.12);
    expect((applyEdit(round, { order: g.order, gap: 0.3 }) as Gallery).radius).toBe(0.12);
    expect((applyEdit(round, { order: g.order, radius: 0 }) as Gallery).radius).toBe(0);
    expect(applyEdit(g, { order: g.order, radius: 0.51 })).toMatch(/radius/);
    expect(applyEdit(g, { order: g.order, radius: -0.1 })).toMatch(/radius/);
    expect(applyEdit(g, { order: g.order, radius: '0.1' })).toMatch(/radius/);
  });

  it('takes a new background, keeps the old one when none is sent, and refuses what is not a colour', () => {
    const pale = applyEdit(g, { order: g.order, background: '#F4F1EA' }) as Gallery;
    expect(pale.background).toBe('#f4f1ea');
    expect((applyEdit(pale, { order: g.order, gap: 0.3 }) as Gallery).background).toBe('#f4f1ea');
    for (const bad of ['red', '#fff', '#12345g', 'url(x)', 222222]) {
      expect(applyEdit(g, { order: g.order, background: bad })).toMatch(/background/);
    }
  });

  it('takes a new hover effect, keeps the old one when none is sent, and refuses one it does not know', () => {
    const ringed = applyEdit(g, { order: g.order, hover: 'ring' }) as Gallery;
    expect(ringed.hover).toBe('ring');
    expect((applyEdit(ringed, { order: g.order, gap: 0.3 }) as Gallery).hover).toBe('ring');
    expect(applyEdit(g, { order: g.order, hover: 'spin' })).toMatch(/hover must be one of lift, zoom/);
    expect(applyEdit(g, { order: g.order, hover: 3 })).toMatch(/hover/);
  });

  it('refuses an order that does not hold every photo once', () => {
    expect(applyEdit(g, { order: ['p0', 'p1', 'p2'] })).toMatch(/missing/);
    expect(applyEdit(g, { order: ['p0', 'p1', 'p2', 'p3'], removed: ['p3'] })).toMatch(/removed/);
  });

  it('refuses a removed list that is not a list of this gallery\'s photos', () => {
    expect(applyEdit(g, { order: g.order, removed: 'p3' })).toMatch(/removed list/);
    expect(applyEdit(g, { order: g.order, removed: ['nope'] })).toMatch(/removed list/);
    expect(applyEdit(g, { order: ['p0', 'p1', 'p2'], removed: ['p3', 'p3'] })).toMatch(/removed list/);
  });

  it('does not change the gallery it was given', () => {
    const before = JSON.stringify(g);
    applyEdit(g, { order: ['p0', 'p1', 'p2'], removed: ['p3'], gap: 0.4 });
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('setLikes', () => {
  const g = gallery(4);
  g.photos.p2 = { ...photo, likes: 1 };

  it('sets the likes of a photo', () => {
    expect((setLikes(g, 'p0', 3) as Gallery).photos.p0).toEqual({ ...photo, likes: 3 });
    expect((setLikes(g, 'p2', 2) as Gallery).photos.p2.likes).toBe(2);
  });

  it('takes the likes away with 0', () => {
    expect((setLikes(g, 'p2', 0) as Gallery).photos.p2).toEqual(photo);
  });

  it('keeps the other photos and the rest of the gallery', () => {
    const out = setLikes(g, 'p0', 2) as Gallery;
    expect(out.order).toEqual(g.order);
    expect(out.photos.p2.likes).toBe(1);
  });

  it('does not change the gallery it was given', () => {
    const before = JSON.stringify(g);
    setLikes(g, 'p2', 3);
    expect(JSON.stringify(g)).toBe(before);
  });

  it('refuses a photo the gallery does not have, and likes that are not 0 to 3', () => {
    expect(setLikes(g, 'nope', 1)).toMatch(/unknown photo/);
    expect(setLikes(g, 7, 1)).toMatch(/unknown photo/);
    for (const likes of [4, -1, 1.5, '2', true, null]) expect(setLikes(g, 'p0', likes)).toMatch(/whole number/);
  });
});

describe('serializeGallery', () => {
  it('writes JSON that reads back the same', () => {
    const g = gallery(5, { size: 1.25, gap: 0.08, radius: 0.06, hover: 'press', background: '#101418', removed: ['x', 'y'] });
    g.photos.p4 = { ...photo, likes: 3 };
    expect(JSON.parse(serializeGallery(g))).toEqual(g);
  });

  it('writes one photo per line', () => {
    const text = serializeGallery(gallery(3));
    expect(text).toContain('    "p1": {"w":1200,"h":1800},\n');
    expect(text).toContain('  "order": [\n    "p0",\n    "p1",\n    "p2"\n  ]');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('writes the date of a photo that has one', () => {
    const g: Gallery = { photos: { a: { w: 3, h: 4, t: '2026-11-12T15:12:31' }, b: { w: 3, h: 4 } }, order: ['a', 'b'] };
    const text = serializeGallery(g);
    expect(text).toContain('"a": {"w":3,"h":4,"t":"2026-11-12T15:12:31"}');
    expect(text).toContain('"b": {"w":3,"h":4}');
    expect(JSON.parse(text)).toEqual(g);
  });

  it('writes the likes of a photo that has some', () => {
    const g: Gallery = { photos: { a: { w: 3, h: 4, likes: 2 }, b: { w: 3, h: 4, likes: 0 } }, order: ['a', 'b'] };
    const text = serializeGallery(g);
    expect(text).toContain('"a": {"w":3,"h":4,"likes":2}');
    expect(text).toContain('"b": {"w":3,"h":4}');
  });

  it('leaves out the fields that are empty', () => {
    const text = serializeGallery(emptyGallery());
    expect(JSON.parse(text)).toEqual({ photos: {}, order: [] });
    expect(text).not.toContain('likes');
    expect(text).not.toContain('removed');
    expect(text).not.toContain('size');
    expect(text).not.toContain('gap');
    expect(text).not.toContain('radius');
    expect(text).not.toContain('hover');
    expect(text).not.toContain('background');
  });
});
