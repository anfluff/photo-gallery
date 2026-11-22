// Opens a photo by flying it from its cell to the centre of the screen. On the
// mesh the photo is cropped to its cell, and the crop opens up during the
// flight. While a photo is open, the arrow keys move to its
// neighbour, and so does a swipe on a touch screen. In admin mode the hearts set how much it is liked, Space or L
// adds a like, the keys 0 to 3 set the likes, and the cross or Backspace
// removes the photo.

import type { Likes, Rect } from './grid.ts';
import { CROSS_SVG, makeLikes, pickedLikes, showLikes } from './heart.ts';
import { MAX_LIKES } from './layout.ts';
import { fit } from './torus.ts';
import { fullUrl, thumbUrl } from './urls.ts';

export interface Shot {
  id: string;
  w: number;
  h: number;
}

interface Options {
  shot: Shot;
  /** Where the photo sits on the mesh, so the flight can start there. */
  home: Rect;
  /** An arrow key or a swipe asks for the neighbour in that direction. Null when there is none. */
  step: (dx: number, dy: number) => Shot | null;
  /** When given, the open photo has a row of hearts. */
  likes?: Likes | null;
  /**
   * When given, the open photo has a remove button, and Backspace does the
   * same. It asks to remove the open photo. Returns the photo to show in its
   * place and the side it comes in from, or null when nothing was removed.
   */
  remove?: () => { shot: Shot; dx: number; dy: number } | null;
  /** Runs when closing starts. Returns where the current photo sits on the mesh now. */
  onClosing: () => Rect | null;
  /** Runs once the photo is back in its cell and the overlay is gone. */
  onClosed: () => void;
}

export interface Lightbox {
  /** Swaps in another photo, which slides in from the given side. */
  show: (shot: Shot, dx: number, dy: number) => void;
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FLY_IN = { duration: 520, easing: EASE_OUT };
const FLY_OUT = { duration: 380, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
const SLIDE = 70; // px a photo travels when an arrow key or a swipe swaps it
const TAP_SLOP = 10; // px a pointer may travel between going down and coming up and still close the photo
const SWIPE = 60; // px a finger has to drag the open photo to move on to its neighbour
const FLICK = 0.5; // px per ms. A drag this fast moves on after 20 px.

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const OPEN = { transform: 'none', clip: 'inset(0px 0px round 0px)' };


/**
 * Makes the full photo at `to` look like the cropped one in the cell at `cell`:
 * scaled until it covers the cell, centred on it, and clipped to it, with the
 * cell's round corners.
 */
function inCell(cell: Rect, to: Rect): { transform: string; clip: string } {
  const scale = Math.max(cell.width / to.width, cell.height / to.height);
  // How far the scaled photo sticks out of the cell on each side.
  const overX = (to.width * scale - cell.width) / 2;
  const overY = (to.height * scale - cell.height) / 2;
  return {
    transform: `translate(${cell.left - overX - to.left}px, ${cell.top - overY - to.top}px) scale(${scale})`,
    clip: `inset(${overY / scale}px ${overX / scale}px round ${(cell.radius ?? 0) / scale}px)`,
  };
}

/**
 * Plays the flight between two states. The frame moves, its inner box holds the
 * crop, and the glow behind the photo fades in on the way out of the cell and
 * away on the way back.
 */
function fly(
  frame: HTMLElement,
  from: { transform: string; clip: string },
  to: { transform: string; clip: string },
  timing: KeyframeAnimationOptions,
): Animation {
  const opening = to === OPEN;
  // A single keyframe animates between it and the opacity set in the stylesheet.
  frame.querySelector('.aura')!.animate([{ opacity: 0, offset: opening ? 0 : 1 }], timing);
  frame.querySelector('.crop')!.animate([{ clipPath: from.clip }, { clipPath: to.clip }], timing);
  return frame.animate([{ transform: from.transform }, { transform: to.transform }], timing);
}

/** The largest box for a photo that fits the window. A portrait photo runs from the top edge to the bottom edge. */
function target(shot: Shot): Rect {
  const size = fit(shot.w, shot.h, innerWidth, innerHeight);
  return { left: (innerWidth - size.w) / 2, top: (innerHeight - size.h) / 2, width: size.w, height: size.h };
}

function place(frame: HTMLElement, shot: Shot): Rect {
  const t = target(shot);
  frame.style.left = `${t.left}px`;
  frame.style.top = `${t.top}px`;
  frame.style.width = `${t.width}px`;
  frame.style.height = `${t.height}px`;
  return t;
}

function makeFrame(shot: Shot): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'frame';
  // The thumbnail is already cached, so it shows at once. The full file fades
  // in over it when it arrives.
  const thumb = new Image();
  thumb.alt = '';
  thumb.src = thumbUrl(shot.id);
  const full = new Image();
  full.alt = '';
  full.className = 'full';
  full.src = fullUrl(shot.id);
  full
    .decode()
    .then(() => full.classList.add('loaded'))
    .catch(() => {
      // The thumbnail stays up if the full file fails to load.
    });
  const crop = document.createElement('div');
  crop.className = 'crop';
  crop.append(thumb, full);
  // A blurred, enlarged copy of the photo sits behind it, so each side glows
  // in the colours of the photo's nearest edge.
  const aura = new Image();
  aura.alt = '';
  aura.className = 'aura';
  aura.src = thumb.src;
  frame.append(aura, crop);
  place(frame, shot);
  return frame;
}

export function openLightbox(options: Options): Lightbox {
  const { shot: first, home, step, likes, remove, onClosing, onClosed } = options;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.className = 'lightbox';
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  let shot = first;
  let frame = makeFrame(shot);
  const hearts = makeLikes();
  root.append(backdrop, frame);
  if (likes) root.append(hearts);
  const cross = document.createElement('button');
  cross.type = 'button';
  cross.className = 'remove';
  cross.title = 'Remove this photo from the gallery (Backspace)';
  cross.setAttribute('aria-label', 'Remove this photo');
  cross.innerHTML = CROSS_SVG;
  if (remove) root.append(cross);
  document.body.append(root);

  /**
   * Tells the stylesheet where the open photo ends, so the cross and the hearts
   * sit in its corners as they do on the mesh.
   */
  const placeControls = (): void => {
    const t = target(shot);
    root.style.setProperty('--photo-top', `${t.top}px`);
    root.style.setProperty('--photo-right', `${innerWidth - t.left - t.width}px`);
    root.style.setProperty('--photo-bottom', `${innerHeight - t.top - t.height}px`);
  };
  placeControls();

  /** Makes the hearts match the photo that is open. */
  const showLike = (): void => showLikes(hearts, likes?.of(shot.id) ?? 0);
  const setLike = (to: number): void => {
    if (!likes) return;
    const more = to > likes.of(shot.id);
    likes.set(shot.id, to);
    showLike();
    if (more && !still) hearts.animate([{ scale: 1 }, { scale: 1.2 }, { scale: 1 }], { duration: 320, easing: EASE_OUT });
  };
  hearts.addEventListener('click', (e) => {
    if (strayClick(e)) return;
    const to = pickedLikes(e.target, likes?.of(shot.id) ?? 0);
    if (to !== null) setLike(to);
  });
  showLike();

  if (still) {
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  } else {
    fly(frame, inCell(home, target(shot)), OPEN, FLY_IN);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  }

  /**
   * Swaps in another photo, which slides in from the given side. The old photo
   * slides away to the other side, or shrinks out of sight when it was removed.
   */
  const swapTo = (next: Shot, dx: number, dy: number, removed = false): void => {
    const old = frame;
    shot = next;
    frame = makeFrame(shot);
    root.append(frame);
    placeControls();
    showLike();
    if (still) {
      old.remove();
      return;
    }
    const gone = (): void => old.remove();
    // The frame scales from its top left corner, so the shift keeps the shrinking photo centred.
    const box = old.getBoundingClientRect();
    const away = removed
      ? `translate(${box.width * 0.09}px, ${box.height * 0.09}px) scale(0.82)`
      : `translate(${-dx * SLIDE}px, ${-dy * SLIDE}px)`;
    old
      .animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: away },
        ],
        { duration: 200, easing: 'ease-out', fill: 'forwards' },
      )
      .finished.then(gone, gone);
    frame.animate(
      [
        { opacity: 0, transform: `translate(${dx * SLIDE}px, ${dy * SLIDE}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 320, easing: EASE_OUT },
    );
  };

  /** Removes the open photo and moves on to the one that takes its place. */
  const removeOpen = (): void => {
    const next = remove?.();
    if (next) swapTo(next.shot, next.dx, next.dy, true);
  };
  cross.addEventListener('click', (e) => {
    if (!strayClick(e)) removeOpen();
  });

  const onResize = (): void => {
    place(frame, shot);
    placeControls();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') return close();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Backspace' && remove) {
      e.preventDefault();
      if (!e.repeat) removeOpen();
      return;
    }
    if (likes && (e.key === ' ' || e.key.toLowerCase() === 'l')) {
      // Without this, Space would also press a button that has focus. See onKeyUp.
      e.preventDefault();
      // One more like each time, and back to none after the most.
      if (!e.repeat) setLike((likes.of(shot.id) + 1) % (MAX_LIKES + 1));
      return;
    }
    if (likes && e.key.length === 1 && e.key >= '0' && e.key <= String(MAX_LIKES)) {
      e.preventDefault();
      setLike(Number(e.key));
      return;
    }
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    const next = step(arrow[0], arrow[1]);
    if (next) swapTo(next, arrow[0], arrow[1]);
  };

  // A button that has focus is pressed when Space comes up, and some browsers
  // do that even when the key going down was handled. A heart or the cross keeps
  // focus after a click, so without this Space would press it again.
  const onKeyUp = (e: KeyboardEvent): void => {
    if (likes && e.key === ' ') e.preventDefault();
  };

  // A press on the overlay closes the photo. It has to go down and come up on
  // the overlay, without moving far. A click event would not do. On a touch
  // screen the browser sends one after the tap that opened the photo, and it
  // can land on the overlay, which closed the photo the moment it opened.
  //
  // A finger can also drag the open photo sideways, up or down. The photo
  // follows it along one axis, and letting go far enough moves on to the
  // neighbour on the side the photo was dragged away from, as the arrow keys do.
  let press: { id: number; x: number; y: number; t: number; touch: boolean; axis: 'x' | 'y' | null } | null = null;
  /** True once a pointer has gone down on the overlay. Until then a click is the end of the tap that opened the photo. */
  let pressed = false;
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    pressed = true;
    // A press on the hearts or the cross is theirs.
    const onControl = e.target instanceof Element && e.target.closest('.likes, .remove');
    press = onControl
      ? null
      : { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, touch: e.pointerType !== 'mouse', axis: null };
  };
  const onMove = (e: PointerEvent): void => {
    const p = press;
    if (!p || e.pointerId !== p.id || !p.touch || closing) return;
    const x = e.clientX - p.x;
    const y = e.clientY - p.y;
    if (!p.axis) {
      if (Math.hypot(x, y) <= TAP_SLOP) return;
      p.axis = Math.abs(x) >= Math.abs(y) ? 'x' : 'y';
    }
    frame.style.translate = p.axis === 'x' ? `${x}px 0px` : `0px ${y}px`;
  };
  /** Lets a dragged photo go back to the middle. */
  const springBack = (): void => {
    const from = frame.style.translate;
    if (!from) return;
    frame.style.translate = '';
    if (!still) frame.animate([{ translate: from }, { translate: '0px 0px' }], { duration: 260, easing: EASE_OUT });
  };
  const onUp = (e: PointerEvent): void => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    const x = e.clientX - p.x;
    const y = e.clientY - p.y;
    if (!p.axis) {
      if (Math.hypot(x, y) <= TAP_SLOP) close();
      return;
    }
    const far = p.axis === 'x' ? x : y;
    const speed = Math.abs(far) / Math.max(1, e.timeStamp - p.t);
    const swiped = Math.abs(far) > SWIPE || (speed > FLICK && Math.abs(far) > 2 * TAP_SLOP);
    // The photo goes where the finger goes, so a swipe to the left brings in the neighbour on the right.
    const dx = p.axis === 'x' ? -Math.sign(far) : 0;
    const dy = p.axis === 'y' ? -Math.sign(far) : 0;
    const next = swiped && !closing ? step(dx, dy) : null;
    // The dragged photo keeps its shift, so it slides away from where the finger left it.
    if (next) swapTo(next, dx, dy);
    else springBack();
  };
  const onCancel = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    springBack();
  };
  /**
   * True for a click on the hearts or the cross that no press on them led to:
   * the click that follows the tap which opened or closed the photo. A click
   * made with the keyboard has no pointer and counts.
   */
  const strayClick = (e: MouseEvent): boolean => closing || (!pressed && e.detail !== 0);

  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    const back = onClosing();
    const finish = (): void => {
      root.remove();
      onClosed();
    };
    if (!still && back) {
      for (const el of [hearts, cross]) el.animate([{ opacity: 0 }], { duration: 150, fill: 'forwards' });
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { ...FLY_OUT, fill: 'forwards' });
      fly(frame, OPEN, inCell(back, target(shot)), { ...FLY_OUT, fill: 'forwards' }).finished.then(finish, finish);
    } else {
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished.then(finish, finish);
    }
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);

  return {
    show: (next, dx, dy) => {
      if (!closing) swapTo(next, dx, dy);
    },
  };
}
