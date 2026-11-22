// The gallery data model. The site, the import script and the dev server all use it.

import { CELL_ASPECT, meshCols, mod, nearestCopy, spiralCells, spiralSlots } from './torus.ts';

export interface Photo {
  w: number;
  h: number;
  /** When the photo was taken, in the local time of the import, like 2026-11-12T15:12:31. */
  t?: string;
  /** How much the photo is liked, from 1 to MAX_LIKES. Absent for a photo without likes. */
  likes?: number;
}

export const MAX_LIKES = 3;

/** The gallery as src/gallery.json stores it. */
export interface Gallery {
  /** How large the cells of the mesh are, as a share of the size the window gives them. DEFAULT_SIZE when absent. */
  size?: number;
  /** Space between cells as a share of the cell width. DEFAULT_GAP when absent. */
  gap?: number;
  /** How round the corners of the photos on the mesh are, as a share of the cell width. DEFAULT_RADIUS when absent. */
  radius?: number;
  /** What a photo on the mesh does under the pointer. DEFAULT_HOVER when absent. */
  hover?: Hover;
  /** The colour behind the photos, like #222222. DEFAULT_BACKGROUND when absent. */
  background?: string;
  photos: Record<string, Photo>;
  /**
   * Every photo once. The first sits in the middle of the mesh and the rest
   * fill the rings around it, after the photos have been sorted by their likes.
   */
  order: string[];
  /** Photos removed in admin mode. The import script leaves these out. */
  removed?: string[];
}

/** An arrangement of photos on the mesh. */
export interface Layout {
  /** Cells in a row of the strip that the mesh is cut from. See torus.ts. */
  cols: number;
  /**
   * True for a plain grid that ends: the photos row after row from the top
   * left, with nothing beyond the last one. The grid itself then sets `cols`
   * to what fits its window.
   */
  bounded?: boolean;
  /** The photo in each slot. Null only in admin mode, for a photo that is removed and not saved yet. */
  cells: (string | null)[];
}

/** The gallery laid out for drawing. */
export interface Mesh extends Layout {
  photos: Record<string, Photo>;
  size?: number;
  gap?: number;
  radius?: number;
  hover?: Hover;
  background?: string;
}

/**
 * What a photo on the mesh can do under the pointer. The stylesheet has the
 * look of each: lift rises above a shadow, zoom enlarges the picture inside its
 * frame, spotlight dims the other photos, ring draws a line around the photo,
 * and press makes it smaller.
 */
export const HOVERS = ['lift', 'zoom', 'spotlight', 'ring', 'press'] as const;
export type Hover = (typeof HOVERS)[number];
export const DEFAULT_HOVER: Hover = 'zoom';
export const isHover = (value: unknown): value is Hover => HOVERS.includes(value as Hover);

export const DEFAULT_BACKGROUND = '#222222';
/** True for a colour written as # and six hex digits, which is what a colour field hands out. */
export const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export const DEFAULT_SIZE = 1;
export const MIN_SIZE = 0.5;
export const MAX_SIZE = 2;
export const DEFAULT_GAP = 0.28;
export const DEFAULT_RADIUS = 0;
/** Half the cell width, which turns the short sides of a cell into half circles. */
export const MAX_RADIUS = 0.5;
export const MAX_GAP = 1;

export const emptyGallery = (): Gallery => ({ photos: {}, order: [] });

/** Adds photos to the gallery. Photos it already has keep their place, and new ones join the outer edge. */
export function addPhotos(g: Gallery, added: Record<string, Photo>): Gallery {
  const fresh = Object.keys(added).filter((id) => !Object.hasOwn(g.photos, id));
  return { ...g, photos: { ...g.photos, ...added }, order: [...g.order, ...fresh] };
}

/**
 * The order with the most liked photos first: those with three likes, then
 * two, then one, then the rest. Photos with the same likes keep their order.
 */
export function byLikes(order: string[], photos: Record<string, Photo>): string[] {
  const likes = (id: string): number => photos[id]?.likes ?? 0;
  return [...order].sort((a, b) => likes(b) - likes(a));
}

/** Lays the photos out from the middle of the mesh outwards, in the given order. */
export function layOut(order: string[]): Layout {
  const cols = meshCols(order.length);
  const cells = new Array<string | null>(order.length).fill(null);
  spiralSlots(cols, order.length).forEach((slot, rank) => {
    cells[slot] = order[rank];
  });
  return { cols, cells };
}

/** The photos oldest first. Photos without a date come last, and photos with the same date keep their order. */
export function byTime(photos: Record<string, Photo>, ids: string[]): string[] {
  const at = (id: string): string => photos[id]?.t ?? '\uffff';
  return [...ids].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
}

/**
 * The order of the mesh after the photos in `gone` have left it, with as few
 * photos moved as can be. Each row closes its gaps towards the middle column:
 * the photos beyond a gap step one cell inwards, and the photos of the other
 * rows stay in their cells.
 *
 * The most liked photos still fill the middle, so a photo only moves into a
 * cell that belongs to photos with its likes. A removed photo with likes
 * makes the area of its likes one cell smaller at its outer edge. The photo in
 * that cell jumps to the cell that came free, and one photo of each lower
 * count of likes jumps in the same way.
 *
 * With fewer photos the mesh repeats in another pattern, so the photos
 * furthest from the middle, where the mesh starts again, get new neighbours
 * anyway.
 */
export function closeGaps(order: string[], gone: ReadonlySet<string>, photos: Record<string, Photo>): string[] {
  const left = order.filter((id) => !gone.has(id));
  const count = left.length;
  if (count === order.length || count === 0) return left;
  const likes = (id: string): number => photos[id]?.likes ?? 0;

  const before = spiralCells(meshCols(order.length), order.length);
  const cols = meshCols(count);
  const after = spiralCells(cols, count);
  const key = (col: number, row: number): string => `${col},${row}`;
  /** The rank in the new mesh of each cell that holds a rank. */
  const rankAt = new Map(after.map((cell, rank) => [key(cell.col, cell.row), rank]));
  /** The likes that the photo of each rank has to have. */
  const wanted = left.map(likes).sort((a, b) => b - a);

  // The cells of each half of each row, from the middle column outwards.
  type Held = { id: string; col: number; row: number };
  const halves = new Map<string, Held[]>();
  order.forEach((id, rank) => {
    const { col, row } = before[rank];
    const half = `${row}${col < 0 ? 'left' : 'right'}`;
    if (!halves.has(half)) halves.set(half, []);
    halves.get(half)!.push({ id, col, row });
  });

  const next = new Array<string | null>(count).fill(null);
  /** Photos that found no cell in their own row. */
  const homeless: Held[] = [];
  for (const cells of halves.values()) {
    cells.sort((a, b) => Math.abs(a.col) - Math.abs(b.col));
    let free = 0; // the innermost cell of this half row that a photo can still step into
    cells.forEach((held, at) => {
      if (gone.has(held.id)) return;
      // A photo steps inwards or stays, and never moves outwards.
      for (let k = free; k <= at; k++) {
        const rank = rankAt.get(key(cells[k].col, cells[k].row));
        if (rank === undefined || wanted[rank] !== likes(held.id)) continue;
        next[rank] = held.id;
        free = k + 1;
        return;
      }
      // The cells this photo could not take stay empty for a photo that
      // jumps in. Without this the rest of the row would step into them, and
      // more photos would move than have to.
      homeless.push(held);
      free = at + 1;
    });
  }

  // The others take the nearest cell that is still empty and belongs to their likes.
  const open = new Set(next.flatMap((id, rank) => (id === null ? [rank] : [])));
  for (const held of homeless) {
    let best = -1;
    let least = Infinity;
    for (const rank of open) {
      if (wanted[rank] !== likes(held.id)) continue;
      const cell = nearestCopy(after[rank].slot, cols, count, held.col, held.row);
      const far = Math.hypot(cell.col - held.col, (cell.row - held.row) * CELL_ASPECT);
      if (far < least) {
        least = far;
        best = rank;
      }
    }
    next[best] = held.id;
    open.delete(best);
  }
  return next as string[];
}

/** Lays the photos out as a plain grid that ends: row after row from the top left, in the given order. */
export function layOutList(order: string[]): Layout {
  return { cols: 1, cells: [...order], bounded: true };
}

/**
 * The nearest cell that holds a photo, walking from `index` in the direction
 * (dx, dy). `steps` is how many cells away it is. Null when there is no other
 * photo that way. In a grid that ends, the walk to the right carries on in the
 * next row, as reading does.
 */
export function nextFilled(
  layout: Layout,
  index: number,
  dx: number,
  dy: number,
): { index: number; steps: number } | null {
  const count = layout.cells.length;
  for (let steps = 1; steps < count; steps++) {
    let next = index + (dx + dy * layout.cols) * steps;
    if (layout.bounded) {
      if (next < 0 || next >= count) return null;
    } else {
      next = mod(next, count);
      // The walk is back where it started, so it has seen every cell on its way.
      if (next === index) return null;
    }
    if (layout.cells[next] !== null) return { index: next, steps };
  }
  return null;
}

const isIdList = (list: unknown): list is string[] =>
  Array.isArray(list) && list.every((id) => typeof id === 'string') && new Set(list).size === list.length;

/**
 * Returns a reason when `order` is not a valid order of the gallery's photos.
 * Photos listed in `removed` must not be in it.
 */
export function validateOrder(g: Gallery, order: unknown, removed: string[] = []): string | null {
  if (!Array.isArray(order)) return 'expected a list of photos';
  const gone = new Set(removed);
  const seen = new Set<string>();
  for (const id of order as unknown[]) {
    if (typeof id !== 'string' || !Object.hasOwn(g.photos, id)) return `unknown photo ${JSON.stringify(id)}`;
    if (gone.has(id)) return `photo ${id} is removed but still placed`;
    if (seen.has(id)) return `photo ${id} is placed twice`;
    seen.add(id);
  }
  if (seen.size !== Object.keys(g.photos).length - gone.size) return 'some photos are missing from the order';
  return null;
}

/** What admin mode sends when it saves. */
export interface Edit {
  order: unknown;
  removed?: unknown;
  size?: unknown;
  gap?: unknown;
  radius?: unknown;
  hover?: unknown;
  background?: unknown;
}

/** Applies an admin save to the gallery. Returns a reason instead when the edit is not valid. */
export function applyEdit(g: Gallery, edit: Edit): Gallery | string {
  const removed = edit.removed ?? [];
  if (!isIdList(removed) || removed.some((id) => !Object.hasOwn(g.photos, id))) {
    return 'the removed list names photos the gallery does not have';
  }
  const problem = validateOrder(g, edit.order, removed);
  if (problem) return problem;
  let size = g.size;
  if (edit.size !== undefined) {
    if (typeof edit.size !== 'number' || !(edit.size >= MIN_SIZE && edit.size <= MAX_SIZE)) {
      return `size must be a number from ${MIN_SIZE} to ${MAX_SIZE}`;
    }
    size = edit.size;
  }
  let gap = g.gap;
  if (edit.gap !== undefined) {
    if (typeof edit.gap !== 'number' || !(edit.gap >= 0 && edit.gap <= MAX_GAP)) {
      return `gap must be a number from 0 to ${MAX_GAP}`;
    }
    gap = edit.gap;
  }
  let radius = g.radius;
  if (edit.radius !== undefined) {
    if (typeof edit.radius !== 'number' || !(edit.radius >= 0 && edit.radius <= MAX_RADIUS)) {
      return `radius must be a number from 0 to ${MAX_RADIUS}`;
    }
    radius = edit.radius;
  }
  let hover = g.hover;
  if (edit.hover !== undefined) {
    if (!isHover(edit.hover)) return `hover must be one of ${HOVERS.join(', ')}`;
    hover = edit.hover;
  }
  let background = g.background;
  if (edit.background !== undefined) {
    if (!isColor(edit.background)) return 'background must be a colour like #222222';
    background = edit.background.toLowerCase();
  }
  const photos = { ...g.photos };
  for (const id of removed) delete photos[id];
  return { size, gap, radius, hover, background, photos, order: edit.order as string[], removed: [...(g.removed ?? []), ...removed] };
}

/** Sets how much a photo is liked, from 0 to MAX_LIKES. Returns a reason instead when that cannot be done. */
export function setLikes(g: Gallery, id: unknown, likes: unknown): Gallery | string {
  if (typeof id !== 'string' || !Object.hasOwn(g.photos, id)) return `unknown photo ${JSON.stringify(id)}`;
  if (typeof likes !== 'number' || !Number.isInteger(likes) || likes < 0 || likes > MAX_LIKES) {
    return `likes must be a whole number from 0 to ${MAX_LIKES}`;
  }
  const { likes: _old, ...photo } = g.photos[id];
  return { ...g, photos: { ...g.photos, [id]: likes > 0 ? { ...photo, likes } : photo } };
}

/** JSON with one photo per line, so git diffs stay readable. */
export function serializeGallery(g: Gallery): string {
  const photos = Object.entries(g.photos)
    .map(([id, p]) => `    ${JSON.stringify(id)}: ${JSON.stringify({ w: p.w, h: p.h, t: p.t, likes: p.likes || undefined })}`)
    .join(',\n');
  const list = (ids: string[]): string =>
    ids.length ? `[\n${ids.map((id) => `    ${JSON.stringify(id)}`).join(',\n')}\n  ]` : '[]';
  const fields: string[] = [];
  if (g.size !== undefined) fields.push(`  "size": ${g.size}`);
  if (g.gap !== undefined) fields.push(`  "gap": ${g.gap}`);
  if (g.radius !== undefined) fields.push(`  "radius": ${g.radius}`);
  if (g.hover !== undefined) fields.push(`  "hover": ${JSON.stringify(g.hover)}`);
  if (g.background !== undefined) fields.push(`  "background": ${JSON.stringify(g.background)}`);
  fields.push(photos ? `  "photos": {\n${photos}\n  }` : '  "photos": {}');
  fields.push(`  "order": ${list(g.order)}`);
  if (g.removed?.length) fields.push(`  "removed": ${JSON.stringify(g.removed)}`);
  return `{\n${fields.join(',\n')}\n}\n`;
}
