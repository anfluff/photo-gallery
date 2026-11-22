import './style.css';
import data from './gallery.json';
import type { Admin } from './admin.ts';
import { Grid } from './grid.ts';
import { byLikes, layOut, nextFilled, type Gallery, type Mesh } from './layout.ts';
import { openLightbox, type Shot } from './lightbox.ts';

const file = data as unknown as Gallery;
const viewport = document.getElementById('viewport')!;
const world = document.getElementById('world')!;
const hint = document.getElementById('hint')!;

// Admin mode exists only in the dev server. The production build drops every branch that checks this.
const admin = import.meta.env.DEV && new URLSearchParams(location.search).has('admin');

if (file.order.length === 0) {
  hint.remove();
  const note = document.createElement('p');
  note.className = 'empty-note';
  note.innerHTML = 'No photos yet. Run <code>npm run import -- &lt;zip or folder&gt;</code> to add some.';
  document.body.append(note);
} else {
  // The most liked photos come first, so they fill the middle of the mesh and
  // the others follow around them, ring by ring.
  const order = byLikes(file.order, file.photos);
  const mesh: Mesh = { ...layOut(order), photos: file.photos, size: file.size, gap: file.gap, radius: file.radius, hover: file.hover, background: file.background };
  // The public page keeps its position in its address, so a link opens at the
  // same spot. Admin mode only keeps it for a reload.
  const grid = new Grid(viewport, world, mesh, admin ? 'session' : 'url');

  grid.onPan = () => {
    hint.classList.add('gone');
    grid.onPan = null;
  };

  /** Admin mode, once its code has loaded. It can like and remove photos. */
  let editor: Admin | null = null;

  grid.onPhotoClick = (hit) => {
    const home = grid.photoRect(hit.col, hit.row);
    if (!hit.id || !home) return;
    hint.classList.add('gone');
    // The photo that is open. Arrow keys move on to a neighbour.
    let openId = hit.id;
    /** The cell of the open photo. A save in admin mode can lay the mesh out again and change it. */
    const openCell = (): number => mesh.cells.indexOf(openId);
    /** Makes the photo in a cell the open one. */
    const take = (index: number): Shot => {
      openId = mesh.cells[index]!;
      grid.hideIndex(index);
      return { id: openId, ...mesh.photos[openId] };
    };

    /** Pans the mesh so that one cell takes the place of another on screen. */
    const follow = (from: number, to: number): { dx: number; dy: number } => {
      const a = grid.locate(from);
      const b = grid.locate(to);
      grid.glideByCells(b.col - a.col, b.row - a.row);
      return { dx: Math.sign(b.col - a.col), dy: Math.sign(b.row - a.row) };
    };

    grid.locked = true;
    viewport.classList.add('receded');
    const box = openLightbox({
      shot: take(hit.index),
      home,
      step: (dx, dy) => {
        const from = openCell();
        const next = nextFilled(mesh, from, dx, dy);
        if (!next) return null;
        // The mesh pans along, so the new photo's cell ends up where the old one was.
        follow(from, next.index);
        return take(next.index);
      },
      likes: editor?.likes,
      // Only admin mode can remove the open photo. The popup then moves on to
      // the next one: the one on the right, or another neighbour when there is none.
      remove: editor
        ? () => {
            const gone = openCell();
            for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
              const next = nextFilled(mesh, gone, dx, dy);
              if (!next) continue;
              follow(gone, next.index);
              const shot = take(next.index);
              editor?.remove(gone);
              return { shot, dx, dy };
            }
            return null;
          }
        : undefined,
      onClosing: () => {
        if (editor) editor.onRestore = null;
        viewport.classList.remove('receded');
        grid.settle();
        const at = grid.locate(openCell());
        return grid.photoRect(at.col, at.row);
      },
      onClosed: () => {
        grid.hideIndex(null);
        grid.locked = false;
      },
    });
    // A removal that is undone while a photo is open brings the restored photo back into view.
    if (editor) {
      editor.onRestore = (index) => {
        if (index === openCell()) return;
        const { dx, dy } = follow(openCell(), index);
        box.show(take(index), dx, dy);
      };
    }
  };

  if (admin) {
    void import('./admin.ts').then((mod) => {
      editor = mod.initAdmin(grid, mesh, file.order);
    });
  }
}
