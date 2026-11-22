// Maths for a mesh that never ends in any direction.
//
// The photos form one long strip that is cut into rows of `cols` cells. Each
// row carries on where the row above stopped, and after the last photo the
// strip starts again. So the cell at (col, row) shows slot
// (row * cols + col) mod count. Every cell of the plane holds a photo whatever
// the count is. A rectangle of cols by rows cells can only do that when the
// count happens to divide, and leaves empty cells otherwise.

/** Remainder that is never negative, so -1 mod 40 is 39. */
export const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** A cell is one and a half times as tall as it is wide. Distances on the mesh are in cell widths. */
export const CELL_ASPECT = 1.5;

/** Squared distance between cells that are dc columns and dr rows apart, times 4 so it stays a whole number. */
const span2 = (dc: number, dr: number): number => 4 * dc * dc + 9 * dr * dr;

export interface Range {
  from: number;
  to: number;
}

/**
 * Cell numbers, inclusive, that overlap the span from `start` to `start + size`,
 * widened by `margin` on both sides. Cells are `step` wide. The numbers are not
 * wrapped, so they can be negative or larger than the mesh.
 */
export function visibleRange(start: number, size: number, step: number, margin = 0): Range {
  return {
    from: Math.floor((start - margin) / step),
    to: Math.floor((start + size + margin) / step),
  };
}

/** The slot shown in the cell at any column and row. */
export function cellIndex(col: number, row: number, cols: number, count: number): number {
  return mod(row * cols + col, count);
}

/** The cell that shows `slot` and lies nearest to a point given in columns and rows. */
export function nearestCopy(
  slot: number,
  cols: number,
  count: number,
  midCol: number,
  midRow: number,
): { col: number; row: number } {
  // Every row shows every slot, so some row this close to the point holds the nearest copy.
  const reach = Math.min(count, Math.ceil(Math.sqrt(count)) + 2);
  const centre = Math.round(midRow);
  let best = { col: 0, row: 0 };
  let least = Infinity;
  for (let row = centre - reach; row <= centre + reach; row++) {
    const first = mod(slot - row * cols, count);
    const col = first + Math.round((midCol - first) / count) * count;
    const far = Math.hypot(col - midCol, (row - midRow) * CELL_ASPECT);
    if (far < least) {
      least = far;
      best = { col, row };
    }
  }
  return best;
}

/**
 * Squared distance from a cell to the nearest other cell that shows the same
 * photo. Stops early once it is known to be no more than `enough`.
 */
function repeatSpan(cols: number, count: number, enough: number): number {
  let least = span2(count, 0);
  for (let dr = 1; span2(0, dr) < least; dr++) {
    const right = mod(-dr * cols, count);
    const dc = right > count / 2 ? right - count : right;
    least = Math.min(least, span2(dc, dr));
    if (least <= enough) break;
  }
  return least;
}

/**
 * How many cells a row of the strip gets. Of all widths this one puts the
 * copies of a photo as far apart as they can be, in every direction.
 */
export function meshCols(count: number): number {
  let best = 1;
  let widest = 0;
  for (let cols = 1; cols < count; cols++) {
    const span = repeatSpan(cols, count, widest);
    if (span > widest) {
      widest = span;
      best = cols;
    }
  }
  return best;
}

/** Where a cell lies around the middle, as an angle. Cells at the same distance fill up in this order. */
const turnOf = (col: number, row: number): number => Math.atan2(row * CELL_ASPECT, col);

/** A cell of the mesh and the slot it shows. */
export interface SpiralCell {
  col: number;
  row: number;
  slot: number;
}

/**
 * The cells in the order in which the mesh fills up from its middle: first the
 * cell at column 0, row 0, then the cells around it, ring by ring. Every slot
 * is in it once, in the cell nearest to the middle that shows it.
 */
export function spiralCells(cols: number, count: number): SpiralCell[] {
  const found: SpiralCell[] = [];
  // Looks at the cells in a disc around the middle. The disc grows until it has met every slot.
  for (let reach = Math.sqrt(count) + 2; found.length < count; reach *= 1.5) {
    const cells: (SpiralCell & { far: number; turn: number })[] = [];
    const rows = Math.floor(reach / CELL_ASPECT);
    for (let row = -rows; row <= rows; row++) {
      const half = Math.floor(Math.sqrt(reach * reach - (row * CELL_ASPECT) ** 2));
      for (let col = -half; col <= half; col++) {
        cells.push({ col, row, slot: cellIndex(col, row, cols, count), far: span2(col, row), turn: turnOf(col, row) });
      }
    }
    cells.sort((a, b) => a.far - b.far || a.turn - b.turn);
    const seen = new Uint8Array(count);
    found.length = 0;
    for (const { col, row, slot } of cells) {
      if (seen[slot]) continue;
      seen[slot] = 1;
      found.push({ col, row, slot });
    }
  }
  return found;
}

/** The slots in the order in which the mesh fills up from its middle. See spiralCells. */
export function spiralSlots(cols: number, count: number): number[] {
  return spiralCells(cols, count).map((cell) => cell.slot);
}

/** Largest size with the aspect ratio of w by h that fits inside the box. */
export function fit(w: number, h: number, boxW: number, boxH: number): { w: number; h: number } {
  const scale = Math.min(boxW / w, boxH / h);
  return { w: w * scale, h: h * scale };
}
