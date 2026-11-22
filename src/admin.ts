// Admin mode: like photos, move them between cells, remove them, set the
// tile size, the spacing, the corner radius, the hover effect and the
// background colour, and save it all to
// src/gallery.json. A like is written to the file
// at once. Everything else waits for Save. main.ts loads this file only in the
// dev server, at /?admin.
//
// The photos can be shown in three ways, picked on the sort panel in the top
// right corner: the mesh of the public site, and two plain grids that end
// after the last photo, one by the time the photos were taken and one by their
// likes. Photos can be moved only in the first.
//
// Every removal shows a chip in the bottom left corner for a few seconds, with
// a button that brings the photo back.
//
// A drag pans the mesh, as on the public site. It moves a photo instead when
// the "Move photos" button is on, or while Option is held.

import type { Grid, Hit, Likes } from './grid.ts';
import { CROSS_SVG } from './heart.ts';
import {
  HOVERS,
  MAX_GAP,
  MAX_RADIUS,
  MAX_SIZE,
  MIN_SIZE,
  byLikes,
  byTime,
  closeGaps,
  isHover,
  layOut,
  layOutList,
  type Hover,
  type Mesh,
} from './layout.ts';
import { thumbUrl } from './urls.ts';

const DRAG_SLOP = 5; // px before a press on a photo becomes a drag
const EDGE = 90; // px from the viewport edge where a drag starts to pan the mesh
const EDGE_SPEED = 22; // px per frame at the very edge
const ARRANGE_KEY = 'gallery-admin-arrange';
const VIEW_KEY = 'gallery-admin-layout';
const BAR_SPACE = 64; // px that the admin bar takes at the top of the window
const SORT_ROW = 50; // px more when the sort panel has to sit under the bar
const PANEL_SPACE = 198; // px that the settings panel takes at the bottom of the window

/** The hover effects as the settings panel names them. */
const HOVER_NAMES: Record<Hover, string> = {
  lift: 'Lift',
  zoom: 'Zoom',
  spotlight: 'Spotlight',
  ring: 'Ring',
  press: 'Press',
};
const CHIP_MS = 6000; // how long the chip of a removal stays
const MAX_CHIPS = 5;

/** The mesh of the public site, or a plain grid of the photos by the time they were taken or by their likes. */
type View = 'public' | 'time' | 'likes';
const VIEWS: View[] = ['public', 'time', 'likes'];
type Removal = { kind: 'remove'; id: string };
/** A move makes two photos trade places in the public order. */
type Step = { kind: 'move'; a: string; b: string } | Removal;

/** What the rest of the site can ask of admin mode. */
export interface Admin {
  likes: Likes;
  /** Removes the photo in a cell. Save makes it final. */
  remove: (index: number) => void;
  /** Runs when a removed photo is brought back, with the cell it went to. */
  onRestore: ((index: number) => void) | null;
}

const css = `
.admin-bar, .admin-sort {
  position: fixed; top: 14px; z-index: 5;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 6px 6px 14px; border-radius: 999px;
  background: rgba(28, 28, 28, 0.94); color: #e8e8e8;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.admin-bar { left: 14px; }
.admin-sort { right: 14px; }
.admin-sort.below { top: ${BAR_SPACE}px; right: auto; left: 14px; }
.admin-sort > span:first-child { margin-right: 4px; color: #a4a4a4; }
.admin-bar strong { font-weight: 600; }
.admin-bar .count { color: #cfcfcf; }
.admin-bar .status { margin: 0 8px 0 2px; color: #a4a4a4; min-width: 13ch; }
.admin-bar .status.dirty { color: #ffd479; }
.admin-bar .status.error { color: #ff8a80; }
:is(.admin-bar, .admin-sort) button {
  font: inherit; color: inherit; cursor: pointer;
  min-width: 30px; padding: 6px 12px; border: 0; border-radius: 999px;
  background: #3a3a3a;
}
:is(.admin-bar, .admin-sort) button:hover:not(:disabled) { background: #4a4a4a; }
.admin-bar button:disabled { opacity: 0.4; cursor: default; }
.admin-bar button.primary:not(:disabled) { background: #e8e8e8; color: #111; }
:is(.admin-bar, .admin-sort) button.on, :is(.admin-bar, .admin-sort) button.on:hover:not(:disabled) { background: #2f6bff; color: #fff; }
#viewport.arranging:not(.dragging) .photo { cursor: move; }
.admin-bar .sep { width: 1px; height: 18px; margin: 0 4px; background: #444; }
.admin-sort .group { display: flex; gap: 2px; }
.admin-sort .group button { border-radius: 6px; }
.admin-sort .group button:first-child { border-radius: 999px 6px 6px 999px; }
.admin-sort .group button:last-child { border-radius: 6px 999px 999px 6px; }
.admin-panel {
  position: fixed; right: 14px; bottom: 14px; z-index: 5;
  display: grid; gap: 8px; padding: 12px 16px; border-radius: 18px;
  background: rgba(28, 28, 28, 0.94); color: #e8e8e8;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.admin-panel label { display: grid; grid-template-columns: 10ch 130px 4ch; align-items: center; gap: 10px; color: #a4a4a4; }
.admin-panel input[type="range"] { width: 100%; margin: 0; accent-color: #e8e8e8; }
.admin-panel output { color: #e8e8e8; text-align: right; font-variant-numeric: tabular-nums; }
.admin-panel select {
  grid-column: 2 / 4; min-width: 0; font: inherit; color: #e8e8e8; cursor: pointer;
  padding: 5px 8px; border: 0; border-radius: 8px; background: #3a3a3a;
}
.admin-panel input[type="color"] {
  grid-column: 2 / 4; width: 100%; height: 26px; padding: 0; border: 0; background: none; cursor: pointer;
}
.admin-panel input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.admin-panel input[type="color"]::-webkit-color-swatch { border: 1px solid #555; border-radius: 8px; }
.cell.empty { box-sizing: border-box; border: 1px dashed #5a5a5a; border-radius: max(4px, var(--photo-radius, 0px)); }
.cell.lifted .photo { opacity: 0.2; }
.cell .remove { top: 6px; }
.admin-chips {
  position: fixed; left: 14px; bottom: 14px; z-index: 20;
  display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 8px;
}
.admin-chip {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 5px 5px 6px; border-radius: 999px;
  background: rgba(28, 28, 28, 0.94); color: #e8e8e8;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: opacity 0.2s, translate 0.2s;
}
.admin-chip.gone { opacity: 0; translate: -12px 0; }
.admin-chip img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.admin-chip button {
  font: inherit; color: #111; cursor: pointer;
  padding: 6px 12px; border: 0; border-radius: 999px; background: #e8e8e8;
}
.admin-chip button:hover { background: #fff; }
.admin-ghost {
  position: fixed; z-index: 6; pointer-events: none; object-fit: cover;
  border-radius: var(--photo-radius, 0px);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35); opacity: 0.95;
}
.admin-target {
  position: fixed; z-index: 4; pointer-events: none; box-sizing: border-box;
  border: 2px solid #2f6bff; border-radius: max(4px, var(--photo-radius, 0px)); background: rgba(47, 107, 255, 0.08);
}
`;

const sameOrder = (a: string[], b: string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

/** Sends a change to the dev server. Rejects with the server's reason when it is refused. */
async function post(path: string, body: object): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reply = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`);
}

/** `fileOrder` is the order in the gallery file. */
export function initAdmin(grid: Grid, mesh: Mesh, fileOrder: string[]): Admin {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'admin-bar';
  bar.innerHTML = `
    <strong>Admin</strong>
    <span class="count" title="Photos in the gallery"></span>
    <span class="status"></span>
    <button data-act="out" title="Zoom out">−</button>
    <button data-act="in" title="Zoom in">+</button>
    <button data-act="centre" title="Go to the middle of the mesh, where the most liked photos are. In the two plain grids, go to the top.">Centre</button>
    <span class="sep"></span>
    <button data-act="arrange" title="When on, dragging a photo moves it to another cell. When off, dragging pans. Option+drag moves a photo at any time. Photos can be moved in the public layout only.">Move photos</button>
    <span class="sep"></span>
    <button data-act="undo" title="Undo the last move or removal (Z or Cmd+Z)">Undo</button>
    <button data-act="revert" title="Go back to the saved state">Revert</button>
    <button data-act="save" class="primary" title="Write the changes to src/gallery.json and close the gaps of removed photos (Cmd+S)">Save</button>
  `;
  document.body.append(bar);
  // The ways to sort the photos have a panel of their own in the top right corner.
  const sort = document.createElement('div');
  sort.className = 'admin-sort';
  sort.innerHTML = `
    <span>Sort</span>
    <span class="group" role="group" aria-label="Sort">
      <button data-view="public" title="The mesh of the public site: the most liked photos in the middle and the others around them">Public</button>
      <button data-view="time" title="All photos by the time they were taken, oldest first, row after row. This grid ends after the last photo.">Chronological</button>
      <button data-view="likes" title="All photos by their likes, the most liked first, row after row. Photos with the same likes go oldest first. This grid ends after the last photo. A photo stays where it is when its likes change. Click here again to sort again.">By likes</button>
    </span>
  `;
  document.body.append(sort);
  // The settings for the look of the mesh have a panel of their own in the bottom right corner.
  const panel = document.createElement('div');
  panel.className = 'admin-panel';
  panel.innerHTML = `
    <label title="How large the photos are. 100% is the size the window gives them."><span>Size</span>
      <input type="range" data-set="size" min="${MIN_SIZE}" max="${MAX_SIZE}" step="0.05" /><output></output>
    </label>
    <label title="Space between photos, as a share of the photo width"><span>Spacing</span>
      <input type="range" data-set="gap" min="0" max="${MAX_GAP}" step="0.02" /><output></output>
    </label>
    <label title="How round the corners of the photos are, as a share of the photo width"><span>Radius</span>
      <input type="range" data-set="radius" min="0" max="${MAX_RADIUS}" step="0.01" /><output></output>
    </label>
    <label title="What a photo does when the pointer is over it. Lift: it rises above a shadow. Zoom: the picture grows inside its frame. Spotlight: the other photos dim. Ring: a line appears around it. Press: it gets smaller."><span>Hover</span>
      <select data-set="hover">
        ${HOVERS.map((hover) => `<option value="${hover}">${HOVER_NAMES[hover]}</option>`).join('')}
      </select>
    </label>
    <label title="The colour behind the photos"><span>Background</span>
      <input type="color" data-set="background" />
    </label>
  `;
  document.body.append(panel);
  const chips = document.createElement('div');
  chips.className = 'admin-chips';
  document.body.append(chips);
  /** The chip of each removal that can still be reverted from the corner. */
  const chipOf = new Map<Removal, HTMLElement>();

  const status = bar.querySelector<HTMLElement>('.status')!;
  const count = bar.querySelector<HTMLElement>('.count')!;
  const sizeSlider = panel.querySelector<HTMLInputElement>('[data-set="size"]')!;
  const gapSlider = panel.querySelector<HTMLInputElement>('[data-set="gap"]')!;
  const radiusSlider = panel.querySelector<HTMLInputElement>('[data-set="radius"]')!;
  const hoverList = panel.querySelector<HTMLSelectElement>('[data-set="hover"]')!;
  const backgroundField = panel.querySelector<HTMLInputElement>('[data-set="background"]')!;
  /** Shows a setting on its slider and as a percentage next to it. */
  const showSetting = (slider: HTMLInputElement, value: number): void => {
    slider.value = String(value);
    slider.nextElementSibling!.textContent = `${Math.round(value * 100)}%`;
  };
  const button = (act: string) => bar.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;

  // The order the public site shows, with the moves that are not saved yet. A
  // removed photo keeps its place in it until the save, so undo can bring it back.
  let order = byLikes(fileOrder, mesh.photos);
  // The state of the last save. Everything below is compared against it.
  let savedFileOrder = fileOrder;
  let savedOrder = [...order];
  let savedSize = grid.getSize();
  let savedGap = grid.getGap();
  let savedRadius = grid.getRadius();
  let savedHover = grid.getHover();
  let savedBackground = grid.getBackground();
  /** Photos removed since the last save. Their data stays in mesh.photos so undo can bring them back. */
  const removed = new Set<string>();
  let steps: Step[] = [];
  let message: { text: string; kind: 'error' | '' } | null = null;
  /** The photo of every cell in the layout on screen, removed photos included. */
  let shown = mesh.cells.map((id) => id ?? '');
  let view: View = 'public';
  /** When true, a drag that starts on a photo moves that photo instead of panning. */
  let arranging = false;
  let wantedView: string | null = null;
  try {
    arranging = sessionStorage.getItem(ARRANGE_KEY) === '1';
    wantedView = sessionStorage.getItem(VIEW_KEY);
  } catch {
    // Without storage the buttons start in their first state.
  }

  const kept = (ids: string[]): string[] => ids.filter((id) => !removed.has(id));

  const pending = (): string[] => {
    const parts: string[] = [];
    // Removed photos are counted on their own, so the order is compared without them.
    if (!sameOrder(kept(order), kept(savedOrder))) parts.push('order');
    if (removed.size) parts.push(`${removed.size} removed`);
    if (grid.getSize() !== savedSize) parts.push('size');
    if (grid.getGap() !== savedGap) parts.push('spacing');
    if (grid.getRadius() !== savedRadius) parts.push('radius');
    if (grid.getHover() !== savedHover) parts.push('hover');
    if (grid.getBackground() !== savedBackground) parts.push('background');
    return parts;
  };

  const update = (): void => {
    const parts = pending();
    const dirty = parts.length > 0;
    status.className = `status ${message?.kind ?? ''} ${dirty && !message ? 'dirty' : ''}`;
    status.textContent = message?.text ?? (dirty ? `Unsaved: ${parts.join(', ')}` : 'No changes');
    const total = order.length - removed.size;
    count.textContent = `${total.toLocaleString('en')} ${total === 1 ? 'photo' : 'photos'}`;
    button('save').disabled = !dirty;
    button('revert').disabled = !dirty;
    button('undo').disabled = steps.length === 0;
    button('out').disabled = grid.getZoom() <= 0.25;
    button('in').disabled = grid.getZoom() >= 1;
    showSetting(sizeSlider, grid.getSize());
    showSetting(gapSlider, grid.getGap());
    showSetting(radiusSlider, grid.getRadius());
    hoverList.value = grid.getHover();
    backgroundField.value = grid.getBackground();
    backgroundField.parentElement!.title = `The colour behind the photos (${grid.getBackground()})`;
    button('arrange').disabled = view !== 'public';
    button('arrange').classList.toggle('on', arranging);
    button('arrange').setAttribute('aria-pressed', String(arranging));
    grid.viewport.classList.toggle('arranging', arranging && view === 'public');
    for (const btn of sort.querySelectorAll('button')) {
      btn.classList.toggle('on', btn.dataset.view === view);
      btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
    }
  };

  // The likes of a photo are written to the file at once, so they survive a reload without a save.
  const likes: Likes = {
    of: (id) => mesh.photos[id]?.likes ?? 0,
    set: (id, to) => {
      const photo = mesh.photos[id];
      const was = photo.likes ?? 0;
      if (to === was) return;
      const show = (n: number): void => {
        if (n > 0) photo.likes = n;
        else delete photo.likes;
        grid.refreshMarks();
      };
      show(to);
      post('/api/like', { id, likes: to }).catch((err: unknown) => {
        // The change did not reach the file, so the hearts go back to what they were.
        show(was);
        message = { text: `Likes not saved: ${err instanceof Error ? err.message : String(err)}`, kind: 'error' };
        update();
      });
    },
  };
  const admin: Admin = { likes, remove: (index) => remove(index), onRestore: null };

  const setArranging = (on: boolean): void => {
    arranging = on;
    try {
      sessionStorage.setItem(ARRANGE_KEY, on ? '1' : '0');
    } catch {
      // The choice then lasts until the page reloads.
    }
  };

  const changedBy = (fn: () => void): void => {
    fn();
    message = null;
    update();
  };

  /** Lays the mesh out again in the current layout. The photo in the middle of the screen stays in place. */
  const draw = (): void => {
    // The sort by likes keeps the order of the first, so photos with the same likes go oldest first.
    const byAge = (): string[] => byTime(mesh.photos, order);
    const layout =
      view === 'public' ? layOut(order) : layOutList(view === 'time' ? byAge() : byLikes(byAge(), mesh.photos));
    shown = layout.cells.map((id) => id ?? '');
    grid.setCells({ ...layout, cells: shown.map((id) => (removed.has(id) ? null : id)) });
  };

  /** Redraws the cells of the given photos after they moved or were removed or brought back. */
  const paint = (...ids: string[]): void => {
    const at = ids.map((id) => shown.indexOf(id));
    const cells = [...mesh.cells];
    for (const index of at) cells[index] = removed.has(shown[index]) ? null : shown[index];
    mesh.cells = cells;
    grid.refresh(at);
  };

  /** Makes two photos trade places in the public order. */
  const trade = (a: string, b: string): void => {
    const i = order.indexOf(a);
    const j = order.indexOf(b);
    [order[i], order[j]] = [order[j], order[i]];
    // The plain grids do not depend on the public order, so nothing moves there.
    if (view !== 'public') return;
    const si = shown.indexOf(a);
    const sj = shown.indexOf(b);
    [shown[si], shown[sj]] = [shown[sj], shown[si]];
    paint(a, b);
  };

  const move = (from: number, to: number): void =>
    changedBy(() => {
      const step: Step = { kind: 'move', a: shown[from], b: shown[to] };
      trade(step.a, step.b);
      steps.push(step);
    });

  const setView = (to: View): void => {
    // A second click on the sort by likes sorts again, by the likes the photos have now.
    if (to === view && to !== 'likes') return;
    view = to;
    try {
      sessionStorage.setItem(VIEW_KEY, to);
    } catch {
      // The choice then lasts until the page reloads.
    }
    if (to === 'public') {
      // The public site sorts the photos by the likes they have now, so this layout does too.
      const untouched = sameOrder(order, savedOrder);
      savedOrder = byLikes(savedFileOrder, mesh.photos);
      order = untouched ? [...savedOrder] : byLikes(order, mesh.photos);
    }
    draw();
  };

  const dropChip = (step: Removal): void => {
    const chip = chipOf.get(step);
    if (!chip) return;
    chipOf.delete(step);
    chip.classList.add('gone');
    setTimeout(() => chip.remove(), 200);
  };

  const dropChips = (): void => {
    for (const step of [...chipOf.keys()]) dropChip(step);
  };

  /** Shows the chip of a removal for a few seconds. The time does not run while the pointer is over it. */
  const showChip = (step: Removal): void => {
    const chip = document.createElement('div');
    chip.className = 'admin-chip gone';
    const thumb = new Image();
    thumb.alt = '';
    thumb.src = thumbUrl(step.id);
    const text = document.createElement('span');
    text.textContent = 'Photo removed';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Undo';
    back.addEventListener('click', () => restore(step));
    chip.append(thumb, text, back);
    chips.append(chip);
    chipOf.set(step, chip);
    requestAnimationFrame(() => chip.classList.remove('gone'));

    let timer = 0;
    const start = (): void => {
      timer = window.setTimeout(() => dropChip(step), CHIP_MS);
    };
    chip.addEventListener('pointerenter', () => clearTimeout(timer));
    chip.addEventListener('pointerleave', start);
    start();

    const oldest = chipOf.keys().next().value;
    if (chipOf.size > MAX_CHIPS && oldest) dropChip(oldest);
  };

  const remove = (index: number): void => {
    const id = mesh.cells[index];
    if (!id) return;
    const step: Removal = { kind: 'remove', id };
    changedBy(() => {
      removed.add(id);
      paint(id);
      steps.push(step);
    });
    showChip(step);
  };

  /** Brings a removed photo back, from its chip or from Undo. */
  const restore = (step: Removal): void => {
    const at = steps.indexOf(step);
    if (at < 0) return;
    steps.splice(at, 1);
    changedBy(() => {
      removed.delete(step.id);
      paint(step.id);
    });
    dropChip(step);
    admin.onRestore?.(shown.indexOf(step.id));
  };

  const undo = (): void => {
    const step = steps.at(-1);
    if (!step) return;
    if (step.kind === 'remove') return restore(step);
    // While a photo is open, a move is not undone: it would swap the open photo's cell under it.
    if (grid.locked) return;
    steps.pop();
    changedBy(() => trade(step.a, step.b));
  };

  const revert = (): void =>
    changedBy(() => {
      order = [...savedOrder];
      removed.clear();
      steps = [];
      dropChips();
      grid.setSize(savedSize);
      grid.setGap(savedGap);
      grid.setRadius(savedRadius);
      grid.setHover(savedHover);
      grid.setBackground(savedBackground);
      draw();
    });

  const save = async (): Promise<void> => {
    if (pending().length === 0) return;
    const edit = {
      // Rows close the gaps of removed photos towards the middle, and the other photos stay in their cells.
      order: closeGaps(order, removed, mesh.photos),
      removed: [...removed],
      size: grid.getSize(),
      gap: grid.getGap(),
      radius: grid.getRadius(),
      hover: grid.getHover(),
      background: grid.getBackground(),
    };
    try {
      await post('/api/gallery', edit);
      savedFileOrder = edit.order;
      savedOrder = edit.order;
      savedSize = edit.size;
      savedGap = edit.gap;
      savedRadius = edit.radius;
      savedHover = edit.hover;
      savedBackground = edit.background;
      // The server has deleted the files of removed photos, so they are gone for good.
      const gone = new Set(edit.removed);
      for (const id of gone) {
        delete mesh.photos[id];
        removed.delete(id);
      }
      if (gone.size) {
        // Steps that name a photo that is gone can no longer be undone.
        steps = steps.filter((step) => (step.kind === 'move' ? !gone.has(step.a) && !gone.has(step.b) : !gone.has(step.id)));
        dropChips();
        // Lay the mesh out again without the gaps that the removed photos left.
        order = closeGaps(order, gone, mesh.photos);
        draw();
      }
      message = { text: 'Saved', kind: '' };
    } catch (err) {
      message = { text: `Save failed: ${err instanceof Error ? err.message : String(err)}`, kind: 'error' };
    }
    update();
  };

  bar.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'save') void save();
    else if (act === 'revert') revert();
    else if (act === 'undo') undo();
    else if (act === 'arrange') setArranging(!arranging);
    else if (act === 'centre') grid.goToCentre();
    else if (act === 'out') grid.setZoom(grid.getZoom() / 1.5);
    else if (act === 'in') grid.setZoom(grid.getZoom() * 1.5);
    update();
  });

  sort.addEventListener('click', (e) => {
    const to = (e.target as HTMLElement).closest<HTMLElement>('[data-view]')?.dataset.view as View | undefined;
    if (!to) return;
    setView(to);
    update();
  });

  // The sort panel moves under the bar when the window is too narrow for both
  // side by side. The plain grids then start below the two.
  const placeSort = (): void => {
    sort.classList.remove('below');
    const crowded = bar.getBoundingClientRect().right + 8 > sort.getBoundingClientRect().left;
    sort.classList.toggle('below', crowded);
    grid.topPad = crowded ? BAR_SPACE + SORT_ROW : BAR_SPACE;
  };
  // The bar grows and shrinks with its status text.
  new ResizeObserver(placeSort).observe(bar);
  window.addEventListener('resize', placeSort);

  sizeSlider.addEventListener('input', () => changedBy(() => grid.setSize(Number(sizeSlider.value))));
  gapSlider.addEventListener('input', () => changedBy(() => grid.setGap(Number(gapSlider.value))));
  radiusSlider.addEventListener('input', () => changedBy(() => grid.setRadius(Number(radiusSlider.value))));
  hoverList.addEventListener('change', () =>
    changedBy(() => {
      if (isHover(hoverList.value)) grid.setHover(hoverList.value);
    }),
  );

  backgroundField.addEventListener('input', () => changedBy(() => grid.setBackground(backgroundField.value)));

  // While "Move photos" is on, Space held down turns a press on a photo back into panning.
  let space = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') space = true;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (!e.altKey && !e.repeat && e.key.toLowerCase() === 'z') {
      // Z on its own is undo as well. In the hover list of the settings panel the letter picks an entry instead.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      e.preventDefault();
      undo();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') space = false;
  });

  // Every photo gets a remove button in its top right corner. The stylesheet gives it the look of the hearts.
  grid.decorate = (cell) => {
    const btn = document.createElement('button');
    btn.className = 'remove';
    btn.title = 'Remove this photo from the gallery';
    btn.type = 'button';
    btn.innerHTML = CROSS_SVG;
    cell.append(btn);
  };
  const onRemoveButton = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.remove') : null;
  grid.viewport.addEventListener('click', (e) => {
    const cell = onRemoveButton(e.target)?.closest<HTMLElement>('.cell');
    if (cell) remove(Number(cell.dataset.index));
  });

  grid.interceptDrag = (e, hit) => {
    // A press on a remove button is neither a pan nor a photo drag. Its click handler does the work.
    if (onRemoveButton(e.target)) return true;
    const moving = view === 'public' && (e.altKey || (arranging && !space));
    if (!moving || !hit.id || !hit.overPhoto) return false;
    dragPhoto(grid, e, hit, move);
    return true;
  };

  document.getElementById('hint')?.remove();
  grid.showEmpty = true;
  grid.likes = likes;
  // Admin mode zooms out further than the public page, to see more of the mesh at once.
  grid.minZoom = 0.25;
  grid.onZoom = update;
  placeSort();
  grid.bottomPad = PANEL_SPACE;
  grid.refresh();
  const wanted = VIEWS.find((v) => v === wantedView);
  if (wanted && wanted !== 'public') setView(wanted);
  update();
  return admin;
}

/** Follows one press on a photo until release. A press that never moves opens the photo. */
function dragPhoto(grid: Grid, down: PointerEvent, from: Hit, move: (from: number, to: number) => void): void {
  const vp = grid.viewport;
  const source = grid.photoEl(from.col, from.row);
  if (!source) return;
  vp.setPointerCapture(down.pointerId);

  const box = source.getBoundingClientRect();
  const grabX = down.clientX - box.left;
  const grabY = down.clientY - box.top;
  let x = down.clientX;
  let y = down.clientY;
  let ghost: HTMLImageElement | null = null;
  let target: HTMLElement | null = null;
  let frame = 0;

  const lift = (): void => {
    ghost = new Image();
    ghost.className = 'admin-ghost';
    ghost.src = source.currentSrc || source.src;
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    target = document.createElement('div');
    target.className = 'admin-target';
    document.body.append(target, ghost);
    vp.classList.add('dragging');
    frame = requestAnimationFrame(loop);
  };

  // Runs every frame while a photo is lifted: pans the mesh when the pointer
  // is near an edge and keeps the ghost and the drop marker in place.
  const loop = (): void => {
    const push = (pos: number, size: number): number => {
      if (pos < EDGE) return -EDGE_SPEED * (1 - Math.max(0, pos) / EDGE);
      if (pos > size - EDGE) return EDGE_SPEED * (1 - Math.max(0, size - pos) / EDGE);
      return 0;
    };
    const dx = push(x, innerWidth);
    const dy = push(y, innerHeight);
    if (dx || dy) grid.panBy(dx, dy);

    for (const el of vp.querySelectorAll(`.cell[data-index="${from.index}"]:not(.lifted)`)) {
      el.classList.add('lifted');
    }
    const over = grid.hitTest(x, y);
    const rect = grid.cellRect(over.col, over.row);
    if (target) {
      target.style.left = `${rect.left}px`;
      target.style.top = `${rect.top}px`;
      target.style.width = `${rect.width}px`;
      target.style.height = `${rect.height}px`;
      target.hidden = over.index === from.index;
    }
    if (ghost) {
      ghost.style.left = `${x - grabX}px`;
      ghost.style.top = `${y - grabY}px`;
    }
    frame = requestAnimationFrame(loop);
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== down.pointerId) return;
    x = e.clientX;
    y = e.clientY;
    if (!ghost && Math.hypot(x - down.clientX, y - down.clientY) > DRAG_SLOP) lift();
  };

  const finish = (e: PointerEvent, drop: boolean): void => {
    if (e.pointerId !== down.pointerId) return;
    vp.removeEventListener('pointermove', onMove);
    vp.removeEventListener('pointerup', onUp);
    vp.removeEventListener('pointercancel', onCancel);
    if (vp.hasPointerCapture(down.pointerId)) vp.releasePointerCapture(down.pointerId);
    cancelAnimationFrame(frame);
    const lifted = ghost !== null;
    ghost?.remove();
    target?.remove();
    vp.classList.remove('dragging');
    for (const el of vp.querySelectorAll('.cell.lifted')) el.classList.remove('lifted');

    if (!lifted) {
      if (drop) grid.onPhotoClick?.(from);
      return;
    }
    if (!drop) return;
    const to = grid.hitTest(e.clientX, e.clientY).index;
    if (to !== from.index) move(from.index, to);
  };
  const onUp = (e: PointerEvent): void => finish(e, true);
  const onCancel = (e: PointerEvent): void => finish(e, false);

  vp.addEventListener('pointermove', onMove);
  vp.addEventListener('pointerup', onUp);
  vp.addEventListener('pointercancel', onCancel);
}
