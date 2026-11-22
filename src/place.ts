// The spot of the mesh in the middle of the screen, as it is kept in the
// address of the page. It is counted in cells from the middle cell of the
// mesh, so it means the same on a screen of any size.

export interface Place {
  x: number;
  y: number;
}

const round = (n: number): number => Math.round(n * 100) / 100 || 0;

/** The place as it is written after the # of the address, like "12.35,-4.2". */
export const formatPlace = (place: Place): string => `${round(place.x)},${round(place.y)}`;

/** Reads a place from the part of the address after the #. Null when there is none. */
export function parsePlace(hash: string): Place | null {
  const found = /^#?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(hash);
  return found ? { x: Number(found[1]), y: Number(found[2]) } : null;
}
