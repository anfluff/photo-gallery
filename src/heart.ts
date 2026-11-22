// The controls that admin mode puts on a photo, on the mesh and on the opened
// photo: the row of hearts that sets how much it is liked, and the cross that
// removes it.

import { MAX_LIKES } from './layout.ts';

const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

/** The cross of a remove button. */
export const CROSS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * One heart button per like a photo can have. The stylesheet gives them their
 * look and lays them out from right to left, so the first like is the heart on
 * the right.
 */
export function makeLikes(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'likes';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Likes');
  for (let level = 1; level <= MAX_LIKES; level++) {
    const heart = document.createElement('button');
    heart.type = 'button';
    heart.dataset.level = String(level);
    heart.setAttribute('aria-label', level === 1 ? '1 like' : `${level} likes`);
    heart.innerHTML = HEART_SVG;
    group.append(heart);
  }
  return group;
}

/** Fills as many hearts as the photo has likes. */
export function showLikes(group: HTMLElement, likes: number): void {
  group.classList.toggle('liked', likes > 0);
  for (const heart of group.querySelectorAll('button')) {
    const on = Number(heart.dataset.level) <= likes;
    heart.classList.toggle('on', on);
    heart.setAttribute('aria-pressed', String(on));
  }
}

/**
 * The number of likes a click asks for: as many as the heart that was clicked,
 * or none when that is what the photo has already. Null for a click that was
 * not on a heart.
 */
export function pickedLikes(target: EventTarget | null, current: number): number | null {
  const heart = target instanceof Element ? target.closest<HTMLElement>('.likes button') : null;
  if (!heart) return null;
  const likes = Number(heart.dataset.level);
  return likes === current ? 0 : likes;
}
