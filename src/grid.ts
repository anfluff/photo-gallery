// The draggable mesh. It keeps a camera position in pixels and draws only the
// cells near the viewport. Every photo fills its cell and is cropped to fit.
// Column and row numbers are unbounded here, and cellIndex() turns them into a
// slot of the mesh, which is what makes the mesh endless. A bounded mesh is a
// plain grid that ends, and the camera stops at its edges.

import { makeLikes, pickedLikes, showLikes } from './heart.ts';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_GAP,
  DEFAULT_HOVER,
  DEFAULT_RADIUS,
  DEFAULT_SIZE,
  MAX_GAP,
  MAX_RADIUS,
  MAX_SIZE,
  MIN_SIZE,
  isColor,
  isHover,
  type Hover,
  type Layout,
  type Mesh,
} from './layout.ts';
import { CELL_ASPECT, cellIndex, cellWidth, fullRows, nearestCopy, visibleRange } from './torus.ts';
import { formatPlace, parsePlace, type Place } from './place.ts';
import { thumbUrl } from './urls.ts';

export interface Hit {
  /** Unbounded column and row under the pointer. */
  col: number;
  row: number;
  /** The slot, which is the index into mesh.cells, or -1 beyond the edge of a bounded mesh. */
  index: number;
  id: string | null;
  /** True when the pointer is on the photo itself, not the space between cells. */
  overPhoto: boolean;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** How round the corners are, in px. Square when absent. */
  radius?: number;
}

/** Likes, as the mesh and the popup use them. Only admin mode has them. */
export interface Likes {
  /** How much a photo is liked, from 0 to MAX_LIKES. */
  of: (id: string) => number;
  set: (id: string, likes: number) => void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  samples: { t: number; x: number; y: number }[];
}

const CLICK_SLOP = 5; // px a mouse may travel and still count as a click
const TAP_SLOP = 10; // the same for a finger or a pen, which are less steady
const COAST_MS = 325; // time constant of the glide after a drag
const MAX_SPEED = 6; // px per ms
const PLACE_KEY = 'gallery-place';
/** Marks a remembered position that belongs to the grid that ends, not to the endless mesh. */
const LIST_MARK = 'list:';

/** Two fingers on the mesh. They zoom it by moving apart or together, and move it by moving along. */
interface Pinch {
  /** Where each of the two fingers is now, by pointer id. */
  points: Map<number, { x: number; y: number }>;
  /** How far apart the fingers were at the start, and the zoom then. */
  startSpan: number;
  startZoom: number;
  /** The spot of the mesh that was between the fingers at the start, in cells. It stays between them. */
  col: number;
  row: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export class Grid {
  readonly viewport: HTMLElement;
  readonly mesh: Mesh;
  /** While true the mesh ignores all input. */
  locked = false;
  /** Draws a placeholder in cells whose photo was removed. Admin mode turns it on. */
  showEmpty = false;
  onPhotoClick: ((hit: Hit) => void) | null = null;
  /** Returning true takes the pointer away from panning. Admin mode uses it to drag photos. */
  interceptDrag: ((e: PointerEvent, hit: Hit) => boolean) | null = null;
  onPan: (() => void) | null = null;
  /** Runs for every photo cell the mesh draws. Admin mode uses it to add its remove button. */
  decorate: ((cell: HTMLElement) => void) | null = null;
  /** When set, every photo gets a row of hearts. Admin mode sets it. */
  likes: Likes | null = null;
  /**
   * How far the mesh zooms out. At 0.5 the cells are half as large, so a window
   * shows twice as many rows. Admin mode goes further.
   */
  minZoom = 0.5;
  /** Runs when a pinch or the wheel has changed the zoom. */
  onZoom: (() => void) | null = null;
  /** Space kept free above the first row of a bounded mesh. Admin mode has its bar there. */
  topPad = 0;
  /** Space kept free below the last row of a bounded mesh. Admin mode has its settings panel there. */
  bottomPad = 0;

  private readonly world: HTMLElement;
  private readonly live = new Map<string, HTMLElement>();
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private vw = 0;
  private vh = 0;
  private cellW = 0;
  private cellH = 0;
  private gap = 0;
  /** How round the corners of the photos are, in px. */
  private radius = 0;
  private stepX = 0;
  private stepY = 0;
  private frame = 0;
  private lastT = 0;
  private vx = 0;
  private vy = 0;
  private coasting = false;
  private drag: Drag | null = null;
  private pinch: Pinch | null = null;
  /** The zoom at the start of a pinch on a trackpad in Safari. */
  private gestureZoom = 1;
  /** Distance a glide still has to cover. */
  private remX = 0;
  private remY = 0;
  private glideT = 0;
  private hidden: number | null = null;
  private readonly keep: 'url' | 'session';
  /** The place that the address of the page holds now. */
  private noted = '';
  private noteTimer = 0;
  /** A position from before a reload that belongs to the grid that ends. It waits for the switch to that grid. */
  private listPlace: Place | null = null;

  /**
   * `keep` says where the position on the mesh is remembered. With 'url' it is
   * written into the address of the page while the mesh moves, so the address
   * can be sent to someone and opens at the same spot. With 'session' it only
   * survives a reload of this tab. Without a remembered position the first
   * view is the middle of the mesh.
   */
  constructor(viewport: HTMLElement, world: HTMLElement, mesh: Mesh, keep: 'url' | 'session') {
    this.viewport = viewport;
    this.world = world;
    this.mesh = mesh;
    this.keep = keep;
    this.setHover(this.getHover());
    this.setBackground(this.getBackground());
    this.measure();
    if (!this.restorePlace()) this.centre();
    this.noted = formatPlace(this.here());
    this.bind();
    this.render();
  }

  /**
   * Goes to the middle of the mesh, the cell at column 0 and row 0. A window
   * that shows two rows in full gets that row and the one above it. In a
   * bounded mesh the middle is its start, at the top.
   */
  goToCentre(): void {
    this.settle();
    this.coasting = false;
    this.centre();
    this.invalidate();
  }

  private centre(): void {
    // With the middle row in the middle of a window of two rows, both rows next to it would be cut.
    this.moveTo({ x: 0, y: fullRows(this.vw, this.vh) === 2 ? -0.5 : 0 });
    if (this.mesh.bounded) this.camY = -this.topPad;
  }

  /** The spot in the middle of the screen, in cells from the middle cell of the mesh. */
  private here(): Place {
    return {
      x: (this.camX + this.vw / 2) / this.stepX - 0.5,
      y: (this.camY + this.vh / 2) / this.stepY - 0.5,
    };
  }

  private moveTo(place: Place): void {
    this.camX = (place.x + 0.5) * this.stepX - this.vw / 2;
    this.camY = (place.y + 0.5) * this.stepY - this.vh / 2;
  }

  /** The slot shown in a cell, or -1 for a cell beyond the edge of a bounded mesh. */
  private slotAt(col: number, row: number): number {
    const { cols, cells, bounded } = this.mesh;
    if (!bounded) return cellIndex(col, row, cols, cells.length);
    const index = row * cols + col;
    return col >= 0 && col < cols && index >= 0 && index < cells.length ? index : -1;
  }

  /** The cell that shows a slot and lies nearest to a point given in columns and rows. */
  private copyNear(index: number, col: number, row: number): { col: number; row: number } {
    const { cols, cells, bounded } = this.mesh;
    if (bounded) return { col: index % cols, row: Math.floor(index / cols) };
    return nearestCopy(index, cols, cells.length, col, row);
  }

  /** What is under a point given in client coordinates. */
  hitTest(clientX: number, clientY: number): Hit {
    const wx = this.camX + clientX;
    const wy = this.camY + clientY;
    const col = Math.floor(wx / this.stepX);
    const row = Math.floor(wy / this.stepY);
    const index = this.slotAt(col, row);
    const id = index < 0 ? null : this.mesh.cells[index];
    const x = wx - col * this.stepX - this.gap / 2;
    const y = wy - row * this.stepY - this.gap / 2;
    const overPhoto = id !== null && x >= 0 && x <= this.cellW && y >= 0 && y <= this.cellH;
    return { col, row, index, id, overPhoto };
  }

  /** Where a cell sits on screen, in client coordinates. */
  cellRect(col: number, row: number): Rect {
    return {
      left: col * this.stepX + this.gap / 2 - this.camX,
      top: row * this.stepY + this.gap / 2 - this.camY,
      width: this.cellW,
      height: this.cellH,
      radius: this.radius,
    };
  }

  /** Where the photo in a cell sits on screen, in client coordinates. Null for an empty cell. */
  photoRect(col: number, row: number): Rect | null {
    const index = this.slotAt(col, row);
    return index >= 0 && this.mesh.cells[index] ? this.cellRect(col, row) : null;
  }

  /**
   * Column and row of a cell, given its index. An endless mesh repeats, so this
   * picks the copy closest to the middle of the screen, counting a glide as
   * finished.
   */
  locate(index: number): { col: number; row: number } {
    const midCol = (this.camX + this.remX + this.vw / 2) / this.stepX - 0.5;
    const midRow = (this.camY + this.remY + this.vh / 2) / this.stepY - 0.5;
    return this.copyNear(index, midCol, midRow);
  }

  /**
   * Replaces the arrangement, as after a save that closed the gaps left by
   * removed photos, or a switch to another layout. The photo nearest the
   * middle of the screen stays in place, as far as the new layout allows.
   */
  setCells(layout: Layout): void {
    this.settle();
    const mesh = this.mesh;
    const old = mesh.cells;
    const hiddenId = this.hidden === null ? null : old[this.hidden];
    const midCol = (this.camX + this.vw / 2) / this.stepX - 0.5;
    const midRow = (this.camY + this.vh / 2) / this.stepY - 0.5;
    let anchor: { col: number; row: number; id: string } | null = null;
    let least = Infinity;
    for (let row = Math.round(midRow) - 3; row <= Math.round(midRow) + 3; row++) {
      for (let col = Math.round(midCol) - 3; col <= Math.round(midCol) + 3; col++) {
        const slot = this.slotAt(col, row);
        const id = slot < 0 ? null : old[slot];
        const far = Math.hypot(col - midCol, (row - midRow) * CELL_ASPECT);
        if (id && far < least) {
          least = far;
          anchor = { col, row, id };
        }
      }
    }
    mesh.cols = layout.cols;
    mesh.cells = layout.cells;
    mesh.bounded = layout.bounded;
    this.fitCols();
    const slot = anchor ? mesh.cells.indexOf(anchor.id) : -1;
    if (anchor && slot >= 0) {
      const at = this.copyNear(slot, anchor.col, anchor.row);
      this.camX += (at.col - anchor.col) * this.stepX;
      this.camY += (at.row - anchor.row) * this.stepY;
    }
    if (this.listPlace && mesh.bounded) this.moveTo(this.listPlace);
    this.listPlace = null;
    const hidden = hiddenId ? mesh.cells.indexOf(hiddenId) : -1;
    this.hidden = hidden >= 0 ? hidden : null;
    this.refresh();
  }

  /** Pans smoothly by a number of cells. Calls add up, so it can be called again mid-glide. */
  glideByCells(dCols: number, dRows: number): void {
    if (this.remX === 0 && this.remY === 0) this.glideT = performance.now();
    this.remX += dCols * this.stepX;
    this.remY += dRows * this.stepY;
    this.invalidate();
  }

  /** Finishes a glide at once and redraws, so positions read right after are final. */
  settle(): void {
    this.camX += this.remX;
    this.camY += this.remY;
    this.remX = 0;
    this.remY = 0;
    this.render();
  }

  /** Hides the photo in one cell while it is shown in the popup. Null shows it again. */
  hideIndex(index: number | null): void {
    this.hidden = index;
    for (const el of this.live.values()) el.classList.toggle('away', Number(el.dataset.index) === index);
  }

  /** Updates the hearts of the cells that are on screen, after the likes of a photo changed. */
  refreshMarks(): void {
    for (const el of this.live.values()) {
      const id = this.mesh.cells[Number(el.dataset.index)];
      this.mark(el, id && this.likes ? this.likes.of(id) : 0);
    }
  }

  private mark(cell: HTMLElement, likes: number): void {
    cell.classList.toggle('liked', likes > 0);
    const hearts = cell.querySelector<HTMLElement>('.likes');
    if (hearts) showLikes(hearts, likes);
  }

  /** The drawn image for a cell, if that cell is on screen and holds a photo. */
  photoEl(col: number, row: number): HTMLImageElement | null {
    return this.live.get(`${col}:${row}`)?.querySelector('img') ?? null;
  }

  panBy(dx: number, dy: number): void {
    this.camX += dx;
    this.camY += dy;
    this.invalidate();
  }

  /** Redraws the given cells, or every cell, after the gallery data changed. */
  refresh(indices?: number[]): void {
    for (const [key, el] of this.live) {
      if (indices && !indices.includes(Number(el.dataset.index))) continue;
      el.remove();
      this.live.delete(key);
    }
    this.invalidate();
  }

  getZoom(): number {
    return this.zoom;
  }

  /** Scales the cells. 1 is the full size, and a smaller number shows more of the mesh at once. */
  setZoom(zoom: number): void {
    this.zoom = clamp(zoom, this.minZoom, 1);
    this.relayout();
  }

  /**
   * Zooms so that a spot of the mesh, given in cells, ends up at a point of the
   * screen. The cells on screen change size in place, so a pinch does not load
   * or fade them in again.
   */
  private zoomAbout(zoom: number, col: number, row: number, x: number, y: number): void {
    const to = clamp(zoom, this.minZoom, 1);
    if (to !== this.zoom) {
      this.zoom = to;
      this.measure();
      for (const [key, el] of this.live) {
        const [c, r] = key.split(':').map(Number);
        el.style.width = `${this.cellW}px`;
        el.style.height = `${this.cellH}px`;
        this.place(el, c, r);
      }
      this.onZoom?.();
    }
    this.camX = col * this.stepX - x;
    this.camY = row * this.stepY - y;
    this.invalidate();
  }

  /** Zooms while the spot of the mesh under a point of the screen stays under it. */
  private zoomAt(zoom: number, x: number, y: number): void {
    // A grid that ends lays its rows out again for the new cell size.
    if (this.mesh.bounded) {
      const before = this.zoom;
      this.setZoom(zoom);
      if (this.zoom !== before) this.onZoom?.();
      return;
    }
    this.settle();
    this.coasting = false;
    this.zoomAbout(zoom, (this.camX + x) / this.stepX, (this.camY + y) / this.stepY, x, y);
  }

  getSize(): number {
    return this.mesh.size ?? DEFAULT_SIZE;
  }

  /** Sets how large the cells are, as a share of the size the window gives them. */
  setSize(size: number): void {
    this.mesh.size = clamp(size, MIN_SIZE, MAX_SIZE);
    this.relayout();
  }

  getGap(): number {
    return this.mesh.gap ?? DEFAULT_GAP;
  }

  /** Sets the space between cells, as a share of the cell width. */
  setGap(gap: number): void {
    this.mesh.gap = clamp(gap, 0, MAX_GAP);
    this.relayout();
  }

  getHover(): Hover {
    return isHover(this.mesh.hover) ? this.mesh.hover : DEFAULT_HOVER;
  }

  /** Sets what a photo does under the pointer. The stylesheet reads it from the viewport. */
  setHover(hover: Hover): void {
    this.mesh.hover = hover;
    this.viewport.dataset.hover = hover;
  }

  getBackground(): string {
    return isColor(this.mesh.background) ? this.mesh.background : DEFAULT_BACKGROUND;
  }

  /**
   * Sets the colour behind the photos. The stylesheet reads it from the page,
   * together with a colour for lines that shows up against it. The browser
   * gets it too, for the bars it draws around the page.
   */
  setBackground(color: string): void {
    if (!isColor(color)) return;
    this.mesh.background = color.toLowerCase();
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
    // How bright the eye takes the colour to be, from 0 to 255.
    const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
    const page = document.documentElement.style;
    page.setProperty('--bg', this.mesh.background);
    page.setProperty('--ink', light ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.9)');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.mesh.background);
  }

  getRadius(): number {
    return this.mesh.radius ?? DEFAULT_RADIUS;
  }

  /** Sets how round the corners of the photos are, as a share of the cell width. */
  setRadius(radius: number): void {
    this.mesh.radius = clamp(radius, 0, MAX_RADIUS);
    this.roundCorners();
  }

  /** Hands the corner radius to the stylesheet. It is set on the page, so admin mode can use it outside the mesh. */
  private roundCorners(): void {
    this.radius = Math.round(this.cellW * this.getRadius());
    document.documentElement.style.setProperty('--photo-radius', `${this.radius}px`);
  }

  private measure(): void {
    this.vw = this.viewport.clientWidth;
    this.vh = this.viewport.clientHeight;
    // The window sets the size, so it shows the same number of rows on every screen. The size setting scales that.
    this.cellW = Math.round(cellWidth(this.vw, this.vh, this.getGap()) * this.getSize() * this.zoom);
    // Two thirds of the photos are 9:16 and a quarter are 3:4. A 2:3 cell sits between them.
    this.cellH = Math.round(this.cellW * CELL_ASPECT);
    this.gap = Math.round(this.cellW * this.getGap());
    this.stepX = this.cellW + this.gap;
    this.stepY = this.cellH + this.gap;
    this.fitCols();
    this.roundCorners();
  }

  /** A bounded mesh gets as many columns as fit the window, so it only moves up and down. */
  private fitCols(): void {
    if (this.mesh.bounded) this.mesh.cols = Math.max(1, Math.floor(this.vw / this.stepX));
  }

  /** Recomputes cell sizes and keeps the same spot of the mesh at the centre of the screen. */
  private relayout(): void {
    this.settle();
    const here = this.here();
    const mid = this.hitTest(this.vw / 2, this.vh / 2).index;
    this.measure();
    this.moveTo(here);
    // A bounded mesh has another number of columns now, so the photo that was in the middle is in another row.
    if (this.mesh.bounded && mid >= 0) {
      this.camY = (this.copyNear(mid, 0, 0).row + 0.5) * this.stepY - this.vh / 2;
    }
    this.refresh();
  }

  /** Goes to the remembered position. Returns false when there is none. */
  private restorePlace(): boolean {
    let saved = '';
    if (this.keep === 'url') {
      saved = location.hash;
    } else {
      try {
        saved = sessionStorage.getItem(PLACE_KEY) ?? '';
      } catch {
        // Storage can be unavailable.
      }
    }
    if (saved.startsWith(LIST_MARK)) {
      this.listPlace = parsePlace(saved.slice(LIST_MARK.length));
      return false;
    }
    const place = parsePlace(saved);
    if (!place) return false;
    this.moveTo(place);
    return true;
  }

  private savePlace = (): void => {
    try {
      sessionStorage.setItem(PLACE_KEY, (this.mesh.bounded ? LIST_MARK : '') + formatPlace(this.here()));
    } catch {
      // Nothing to do without storage.
    }
  };

  /** Writes the position into the address of the page, a moment after the mesh has stopped moving. */
  private notePlace(): void {
    if (formatPlace(this.here()) === this.noted) return;
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      this.noted = formatPlace(this.here());
      // This replaces the entry in the history, so the Back button still leaves the page.
      history.replaceState(history.state, '', `${location.pathname}${location.search}#${this.noted}`);
    }, 250);
  }

  /** Someone changed the place in the address by hand, or followed a link to another spot of this page. */
  private onHashChange = (): void => {
    const place = parsePlace(location.hash);
    if (!place || formatPlace(place) === this.noted) return;
    this.settle();
    this.coasting = false;
    this.moveTo(place);
    this.noted = formatPlace(place);
    this.invalidate();
  };

  private bind(): void {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', this.onPointerDown);
    vp.addEventListener('pointermove', this.onPointerMove);
    vp.addEventListener('pointerup', this.onPointerUp);
    vp.addEventListener('pointercancel', this.onPointerCancel);
    vp.addEventListener('wheel', this.onWheel, { passive: false });
    // Safari reports a pinch on a trackpad with events of its own.
    vp.addEventListener('gesturestart', this.onGesture);
    vp.addEventListener('gesturechange', this.onGesture);
    vp.addEventListener('dragstart', (e) => e.preventDefault());
    vp.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', () => this.relayout());
    if (this.keep === 'session') window.addEventListener('pagehide', this.savePlace);
    else window.addEventListener('hashchange', this.onHashChange);
  }

  /** Clicks reach the mesh only from the buttons inside cells. A press on a photo is handled as a pointer drag. */
  private onClick = (e: MouseEvent): void => {
    const cell = e.target instanceof Element ? e.target.closest<HTMLElement>('.cell') : null;
    if (!cell || this.locked || !this.likes) return;
    const id = this.mesh.cells[Number(cell.dataset.index)];
    if (!id) return;
    const likes = pickedLikes(e.target, this.likes.of(id));
    if (likes !== null) this.likes.set(id, likes);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.locked || e.button !== 0) return;
    if (this.drag) {
      // A second finger turns the drag into a pinch.
      if (!this.pinch && e.pointerType === 'touch' && !this.mesh.bounded) this.startPinch(e);
      return;
    }
    // A press on a control inside a cell is that control's click, not the start of a pan.
    if (e.target instanceof Element && e.target.closest('button, .likes')) return;
    this.coasting = false;
    if (this.interceptDrag?.(e, this.hitTest(e.clientX, e.clientY))) return;
    this.viewport.setPointerCapture(e.pointerId);
    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
    };
  };

  private startPinch(e: PointerEvent): void {
    const d = this.drag!;
    // The first finger no longer taps a photo.
    d.moved = true;
    this.viewport.classList.add('dragging');
    this.settle();
    this.coasting = false;
    this.viewport.setPointerCapture(e.pointerId);
    const a = { x: d.lastX, y: d.lastY };
    const b = { x: e.clientX, y: e.clientY };
    this.pinch = {
      points: new Map([
        [d.pointerId, a],
        [e.pointerId, b],
      ]),
      startSpan: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startZoom: this.zoom,
      col: (this.camX + (a.x + b.x) / 2) / this.stepX,
      row: (this.camY + (a.y + b.y) / 2) / this.stepY,
    };
    this.onPan?.();
  }

  private movePinch(e: PointerEvent): void {
    const p = this.pinch!;
    const point = p.points.get(e.pointerId);
    if (!point) return;
    point.x = e.clientX;
    point.y = e.clientY;
    const [a, b] = [...p.points.values()];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    this.zoomAbout((p.startZoom * span) / p.startSpan, p.col, p.row, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  /** One of the two fingers has left. The other one carries on as a drag. */
  private endPinch(e: PointerEvent): void {
    const p = this.pinch!;
    if (!p.points.has(e.pointerId)) return;
    this.pinch = null;
    if (this.viewport.hasPointerCapture(e.pointerId)) this.viewport.releasePointerCapture(e.pointerId);
    p.points.delete(e.pointerId);
    const [id, at] = [...p.points.entries()][0];
    const d = this.drag!;
    d.pointerId = id;
    d.lastX = at.x;
    d.lastY = at.y;
    // The drag starts over, so the mesh does not glide on at the speed of the pinch.
    d.samples = [{ t: e.timeStamp, x: at.x, y: at.y }];
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pinch) return this.movePinch(e);
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const slop = e.pointerType === 'mouse' ? CLICK_SLOP : TAP_SLOP;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > slop) {
      d.moved = true;
      this.viewport.classList.add('dragging');
    }
    this.camX -= e.clientX - d.lastX;
    this.camY -= e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 80) d.samples.shift();
    this.invalidate();
    if (d.moved) this.onPan?.();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pinch) return this.endPinch(e);
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.endDrag();
    if (!d.moved) {
      const hit = this.hitTest(e.clientX, e.clientY);
      if (hit.id && hit.overPhoto) this.onPhotoClick?.(hit);
      return;
    }
    // Glide on at the speed of the last 80ms of the drag, unless the pointer had stopped.
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const span = last.t - first.t;
    if (span <= 0 || e.timeStamp - last.t > 60) return;
    this.vx = clamp(-(last.x - first.x) / span, -MAX_SPEED, MAX_SPEED);
    this.vy = clamp(-(last.y - first.y) / span, -MAX_SPEED, MAX_SPEED);
    this.startCoast();
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.pinch) return this.endPinch(e);
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag();
  };

  private endDrag(): void {
    if (!this.drag) return;
    if (this.viewport.hasPointerCapture(this.drag.pointerId)) {
      this.viewport.releasePointerCapture(this.drag.pointerId);
    }
    this.drag = null;
    this.viewport.classList.remove('dragging');
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.locked) return;
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    // A pinch on a trackpad arrives as a wheel event with the Ctrl key down. So does the wheel with Ctrl held.
    if (e.ctrlKey) {
      // One notch of a mouse wheel is 100 or more, which would zoom all the way at once.
      const turn = clamp(e.deltaY * unit, -30, 30);
      this.zoomAt(this.zoom * Math.exp(-turn / 100), e.clientX, e.clientY);
      return;
    }
    this.coasting = false;
    this.panBy(e.deltaX * unit, e.deltaY * unit);
    this.onPan?.();
  };

  private onGesture = (e: Event): void => {
    e.preventDefault();
    // On a touch screen the two fingers are pointers, and the pinch above handles them.
    if (this.locked || this.drag || this.pinch) return;
    const g = e as Event & { scale: number; clientX: number; clientY: number };
    if (e.type === 'gesturestart') this.gestureZoom = this.zoom;
    else this.zoomAt(this.gestureZoom * g.scale, g.clientX, g.clientY);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // In a slider or a list the arrow keys belong to that control.
    const inControl = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (this.locked || e.metaKey || e.ctrlKey || e.altKey || inControl) return;
    const push: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = push[e.key];
    if (!dir) return;
    e.preventDefault();
    this.vx = dir[0] * 1.6;
    this.vy = dir[1] * 1.6;
    this.startCoast();
    this.onPan?.();
  };

  private startCoast(): void {
    this.coasting = true;
    this.lastT = performance.now();
    this.invalidate();
  }

  private invalidate(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (t: number): void => {
    this.frame = 0;
    if (this.coasting) {
      const dt = clamp(t - this.lastT, 0, 50);
      this.lastT = t;
      this.camX += this.vx * dt;
      this.camY += this.vy * dt;
      const decay = Math.exp(-dt / COAST_MS);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < 0.01) this.coasting = false;
      else this.invalidate();
    }
    if (this.remX !== 0 || this.remY !== 0) {
      // Cover a fixed share of the remaining distance per unit of time, which eases out.
      const share = 1 - Math.exp(-clamp(t - this.glideT, 0, 50) / 90);
      this.glideT = t;
      const dx = this.remX * share;
      const dy = this.remY * share;
      this.camX += dx;
      this.camY += dy;
      this.remX -= dx;
      this.remY -= dy;
      if (Math.hypot(this.remX, this.remY) < 0.5) {
        this.camX += this.remX;
        this.camY += this.remY;
        this.remX = 0;
        this.remY = 0;
      } else {
        this.invalidate();
      }
    }
    this.render();
  };

  /**
   * Keeps the camera within one lap of the mesh so the numbers stay bounded.
   * The mesh looks the same again after as many columns, or as many rows, as
   * it has photos. Cells on screen are renumbered to match, so nothing moves
   * visibly.
   */
  private rebase(): void {
    if (this.mesh.bounded) return this.keepInside();
    const lap = this.mesh.cells.length;
    const lapsX = Math.round(this.camX / (lap * this.stepX));
    const lapsY = Math.round(this.camY / (lap * this.stepY));
    if (lapsX === 0 && lapsY === 0) return;
    this.camX -= lapsX * lap * this.stepX;
    this.camY -= lapsY * lap * this.stepY;
    const renumbered = new Map<string, HTMLElement>();
    for (const [key, el] of this.live) {
      const [col, row] = key.split(':').map(Number);
      const nc = col - lapsX * lap;
      const nr = row - lapsY * lap;
      this.place(el, nc, nr);
      renumbered.set(`${nc}:${nr}`, el);
    }
    this.live.clear();
    for (const [key, el] of renumbered) this.live.set(key, el);
  }

  /** Stops the camera at the edges of a bounded mesh. A mesh narrower than the window sits in its middle. */
  private keepInside(): void {
    const { cols, cells } = this.mesh;
    const width = cols * this.stepX;
    const height = Math.ceil(cells.length / cols) * this.stepY;
    this.camX = width <= this.vw ? (width - this.vw) / 2 : clamp(this.camX, 0, width - this.vw);
    this.camY = clamp(this.camY, -this.topPad, Math.max(-this.topPad, height - this.vh + this.bottomPad));
  }

  private render(): void {
    this.rebase();
    const { cells } = this.mesh;
    const xs = visibleRange(this.camX, this.vw, this.stepX, this.stepX * 1.5);
    const ys = visibleRange(this.camY, this.vh, this.stepY, this.stepY * 1.5);
    const wanted = new Set<string>();
    for (let row = ys.from; row <= ys.to; row++) {
      for (let col = xs.from; col <= xs.to; col++) {
        const index = this.slotAt(col, row);
        if (index < 0) continue;
        const id = cells[index];
        if (!id && !this.showEmpty) continue;
        const key = `${col}:${row}`;
        wanted.add(key);
        if (!this.live.has(key)) this.live.set(key, this.make(col, row, index, id));
      }
    }
    for (const [key, el] of this.live) {
      if (wanted.has(key)) continue;
      el.remove();
      this.live.delete(key);
    }
    this.world.style.transform = `translate3d(${-this.camX}px, ${-this.camY}px, 0)`;
    if (this.keep === 'url') this.notePlace();
  }

  private place(el: HTMLElement, col: number, row: number): void {
    el.style.left = `${col * this.stepX + this.gap / 2}px`;
    el.style.top = `${row * this.stepY + this.gap / 2}px`;
  }

  private make(col: number, row: number, index: number, id: string | null): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.index = String(index);
    if (index === this.hidden) el.classList.add('away');
    el.style.width = `${this.cellW}px`;
    el.style.height = `${this.cellH}px`;
    this.place(el, col, row);
    if (id) {
      const img = new Image();
      img.className = 'photo';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.src = thumbUrl(id);
      if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
      el.append(img);
      if (this.likes) {
        el.append(makeLikes());
        this.mark(el, this.likes.of(id));
      }
      this.decorate?.(el);
    } else {
      el.classList.add('empty');
    }
    this.world.append(el);
    return el;
  }
}
