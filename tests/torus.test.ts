import { describe, expect, it } from 'vitest';
import {
  CELL_ASPECT,
  cellIndex,
  cellWidth,
  fit,
  fullRows,
  meshCols,
  mod,
  nearestCopy,
  spiralSlots,
  visibleRange,
} from '../src/torus.ts';

/** Distance on screen, in cell widths, between cells dc columns and dr rows apart. */
const span = (dc: number, dr: number): number => Math.hypot(dc, dr * CELL_ASPECT);

/** Distance from a cell to the nearest other cell with the same photo, found by looking at every cell around it. */
function nearestRepeat(cols: number, count: number): number {
  let least = Infinity;
  const reach = Math.ceil(2 * Math.sqrt(count)) + 2;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      if ((dc !== 0 || dr !== 0) && cellIndex(dc, dr, cols, count) === 0) least = Math.min(least, span(dc, dr));
    }
  }
  return least;
}

describe('mod', () => {
  it('wraps negative numbers into the mesh', () => {
    expect(mod(-1, 40)).toBe(39);
    expect(mod(-40, 40)).toBe(0);
    expect(mod(-41, 40)).toBe(39);
  });

  it('wraps numbers past the end', () => {
    expect(mod(40, 40)).toBe(0);
    expect(mod(85, 40)).toBe(5);
  });
});

describe('cellIndex', () => {
  it('reads the strip row by row', () => {
    expect(cellIndex(0, 0, 4, 10)).toBe(0);
    expect(cellIndex(3, 0, 4, 10)).toBe(3);
    expect(cellIndex(0, 1, 4, 10)).toBe(4);
    expect(cellIndex(1, 2, 4, 10)).toBe(9);
  });

  it('starts the strip again after the last photo', () => {
    expect(cellIndex(2, 2, 4, 10)).toBe(0);
    expect(cellIndex(10, 0, 4, 10)).toBe(0);
  });

  it('carries on to the left and upwards', () => {
    expect(cellIndex(-1, 0, 4, 10)).toBe(9);
    expect(cellIndex(0, -1, 4, 10)).toBe(6);
  });

  it('shows every photo once in any run of cells as long as the strip', () => {
    for (const [cols, count] of [[4, 10], [3, 7], [5, 13]]) {
      const run = Array.from({ length: count }, (_, i) => cellIndex(i - 20, 3, cols, count));
      expect([...run].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });

  it('leaves no cell without a photo, whatever the count', () => {
    for (const count of [1, 2, 7, 13, 97]) {
      const cols = meshCols(count);
      for (let row = -6; row <= 6; row++) {
        for (let col = -6; col <= 6; col++) {
          const slot = cellIndex(col, row, cols, count);
          expect(Number.isInteger(slot) && slot >= 0 && slot < count).toBe(true);
        }
      }
    }
  });
});

describe('meshCols', () => {
  it('gives at least one cell per row', () => {
    expect(meshCols(1)).toBe(1);
    expect(meshCols(2)).toBe(1);
  });

  it('keeps the copies of a photo far apart in every direction', () => {
    for (const count of [60, 200, 997, 1341]) {
      // The copies of a photo cannot all be further apart than about 1.3 times this.
      expect(nearestRepeat(meshCols(count), count)).toBeGreaterThan(Math.sqrt(count));
    }
  });

  it('does better than a row length picked without care', () => {
    expect(nearestRepeat(meshCols(1341), 1341)).toBeGreaterThan(nearestRepeat(9, 1341) * 2);
  });
});

describe('nearestCopy', () => {
  const cols = meshCols(200);

  it('returns a cell that shows the slot', () => {
    for (const slot of [0, 1, 57, 199]) {
      const at = nearestCopy(slot, cols, 200, 12.3, -40.7);
      expect(cellIndex(at.col, at.row, cols, 200)).toBe(slot);
    }
  });

  it('returns the cell itself when the point is on it', () => {
    expect(nearestCopy(cellIndex(31, -17, cols, 200), cols, 200, 31, -17)).toEqual({ col: 31, row: -17 });
  });

  it('finds no copy that is nearer when every cell around the point is checked', () => {
    for (const [slot, midCol, midRow] of [[5, 0, 0], [120, 33.5, 8.2], [199, -70, 41]]) {
      const at = nearestCopy(slot, cols, 200, midCol, midRow);
      let least = Infinity;
      for (let row = Math.round(midRow) - 30; row <= Math.round(midRow) + 30; row++) {
        for (let col = Math.round(midCol) - 30; col <= Math.round(midCol) + 30; col++) {
          if (cellIndex(col, row, cols, 200) === slot) least = Math.min(least, span(col - midCol, row - midRow));
        }
      }
      expect(span(at.col - midCol, at.row - midRow)).toBeCloseTo(least, 9);
    }
  });
});

describe('spiralSlots', () => {
  it('lists every slot once', () => {
    for (const count of [1, 2, 7, 60, 1341]) {
      const slots = spiralSlots(meshCols(count), count);
      expect([...slots].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });

  it('is empty for an empty mesh', () => {
    expect(spiralSlots(1, 0)).toEqual([]);
  });

  it('starts in the middle, then takes the cells beside it, then those above and below', () => {
    const cols = meshCols(200);
    const slots = spiralSlots(cols, 200);
    const at = (col: number, row: number): number => cellIndex(col, row, cols, 200);
    expect(slots[0]).toBe(at(0, 0));
    expect(slots.slice(1, 3).sort()).toEqual([at(-1, 0), at(1, 0)].sort());
    expect(slots.slice(3, 5).sort()).toEqual([at(0, -1), at(0, 1)].sort());
    expect(slots.slice(5, 9).sort()).toEqual([at(-1, -1), at(1, -1), at(-1, 1), at(1, 1)].sort());
  });

  it('moves outwards and never back towards the middle', () => {
    const cols = meshCols(500);
    const far = spiralSlots(cols, 500).map((slot) => {
      const at = nearestCopy(slot, cols, 500, 0, 0);
      return span(at.col, at.row);
    });
    for (let i = 1; i < far.length; i++) expect(far[i]).toBeGreaterThanOrEqual(far[i - 1] - 1e-9);
  });

  it('keeps the middle of the mesh in place when the number of photos changes', () => {
    const middle = (count: number): string[] => {
      const cols = meshCols(count);
      const rank = new Map(spiralSlots(cols, count).map((slot, i) => [slot, i]));
      const out: string[] = [];
      for (let row = -4; row <= 4; row++) {
        for (let col = -6; col <= 6; col++) out.push(`${col},${row}:${rank.get(cellIndex(col, row, cols, count))}`);
      }
      return out;
    };
    expect(middle(1341)).toEqual(middle(1339));
    expect(middle(1341)).toEqual(middle(900));
  });
});

describe('visibleRange', () => {
  it('lists the cells that overlap the span', () => {
    expect(visibleRange(0, 100, 50)).toEqual({ from: 0, to: 2 });
    expect(visibleRange(-60, 100, 50)).toEqual({ from: -2, to: 0 });
  });

  it('widens the span by the margin', () => {
    expect(visibleRange(0, 100, 50, 50)).toEqual({ from: -1, to: 3 });
  });
});

describe('fit', () => {
  it('scales to the limiting side and keeps the aspect ratio', () => {
    expect(fit(400, 200, 100, 100)).toEqual({ w: 100, h: 50 });
    expect(fit(200, 400, 100, 100)).toEqual({ w: 50, h: 100 });
  });
});

describe('fullRows', () => {
  it('is one on a phone, however it is held, and two on larger windows', () => {
    expect(fullRows(390, 750)).toBe(1);
    expect(fullRows(844, 390)).toBe(1);
    expect(fullRows(820, 1180)).toBe(2);
    expect(fullRows(1470, 923)).toBe(2);
  });
});

describe('cellWidth', () => {
  /** How many rows and columns of the mesh a window shows. */
  const shows = (vw: number, vh: number, gap = 0.02) => {
    const w = cellWidth(vw, vh, gap);
    return { rows: vh / (w * (CELL_ASPECT + gap)), cols: vw / (w * (1 + gap)) };
  };

  it('shows two rows and a part of the next ones on a laptop or a tablet', () => {
    for (const [vw, vh] of [[1470, 923], [1280, 720], [1180, 820], [820, 1180]]) {
      expect(shows(vw, vh).rows).toBeCloseTo(2.45, 5);
    }
  });

  it('shows one photo and a part of its neighbours on a phone held upright', () => {
    const { rows, cols } = shows(390, 750);
    expect(cols).toBeCloseTo(1.45, 5);
    expect(rows).toBeGreaterThan(1.45);
    expect(rows).toBeLessThan(2.2);
  });

  it('shows one row and a part of the next ones on a phone on its side', () => {
    const { rows, cols } = shows(844, 390);
    expect(rows).toBeCloseTo(1.45, 5);
    expect(cols).toBeGreaterThan(3);
  });

  it('keeps the rows when the spacing changes', () => {
    expect(shows(1470, 923, 0)).toEqual({ rows: expect.closeTo(2.45, 5), cols: expect.any(Number) });
    expect(shows(1470, 923, 0.5).rows).toBeCloseTo(2.45, 5);
  });

  it('shows more rows on a large display and never makes a cell too small', () => {
    expect(cellWidth(2560, 1400, 0.02)).toBe(320);
    expect(shows(2560, 1400).rows).toBeGreaterThan(2.45);
    expect(cellWidth(100, 100, 0.02)).toBe(80);
  });
});
