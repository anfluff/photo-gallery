# photo-gallery

My fav photos, laid out on an endless mesh. Drag to move around, click a photo to open it, and use the arrow keys to move between open photos. On a touch screen, swipe the open photo left, right, up or down.

While you move, the address of the page keeps your position, like `#12.35,-4.2`. Send that address to someone and the mesh opens at the same spot for them. The two numbers count cells from the middle of the mesh, so the link works on a screen of any size. It points at a spot, not at a photo: after photos are added, removed or liked differently, other photos lie there.

On the mesh every photo is cropped around its centre to fill a 2:3 cell. The opened photo is shown whole.

## How the mesh is filled

The mesh has no empty cells, whatever the number of photos. The photos form one long strip that is cut into rows, and each row carries on where the row above stopped. The row length is picked so that the copies of a photo lie as far apart as possible in every direction.

The photos fill the mesh from its middle outwards, ring by ring. A photo has from 0 to 3 likes. The photos with 3 likes come first, then those with 2, with 1 and with none, so the most liked photos form the middle. Photos with the same likes keep the order saved in `src/gallery.json`.

## Run it

```sh
npm install
npm run dev
```

The site is at http://localhost:5173. `npm run build` writes the static site to `dist/`.

## Import photos

```sh
npm run import -- ~/Downloads/gphotos-favorites.zip
```

The script takes a zip or a folder of images. For each photo it writes a 2000px file and a thumbnail to `public/photos/`, without EXIF data, and adds the photo and the time it was taken to `src/gallery.json`. Photos that are already imported keep their place, so you can re-run it with a newer download. New photos join the outer edge of the mesh.

`public/photos/` is not in git because of its size. On a fresh clone, run the import again to rebuild it.

### Getting the photos out of Google Photos

Google has no API that reads the Favourites album. `scripts/gphotos-fetch.js` does it from inside the page:

1. Open Google Photos in Chrome and go to your Favourites album.
2. Open DevTools, paste the whole file into the console and press Enter.
3. Wait for `gphotos-favorites.zip` to appear in Downloads, then run the import on it.

## Admin mode

Open http://localhost:5173/?admin while `npm run dev` is running. The bar at the top shows the number of photos in the gallery.

- Hover a photo and click one of the three hearts in its corner to give it 1, 2 or 3 likes. The hearts count from the right, so the first like is the heart in the corner. A click on the heart it already has takes the likes away. An opened photo has the same hearts in the same corner. There, Space or the L key adds a like, and the keys 0 to 3 set the likes. Likes are written to `src/gallery.json` at once. On the next load the most liked photos fill the middle of the mesh. The Centre button goes there.
- The **Sort** panel in the top right corner has three buttons: **Public**, **Chronological** and **By likes**. Public is what the site shows. Chronological is a plain grid of all photos in the order they were taken, oldest first, row after row. By likes is the same kind of grid with the most liked photos first, and the oldest first among photos with the same likes. The two plain grids are not endless: they start at the top and stop after the last photo, and they scroll up and down only. Liking and removing work in all three. In By likes a photo stays where it is when its likes change, and a second click on the button sorts again. The switch keeps the photo in the middle of the screen in view.
- Admin mode does not write the position into the address. It remembers it for a reload of the tab.
- Dragging pans the mesh, as on the public site, and a click opens a photo.
- Turn on **Move photos** to rearrange, in the public layout only. Then drag a photo onto another photo to swap them, or onto an empty cell to move it. Option+drag does the same while the button is off.
- Hold a dragged photo near the edge of the window to pan the mesh.
- Hover a photo and click the × in its corner to remove it from the gallery. An opened photo has the same × in the same corner, and Backspace does the same. Both remove the photo and move on to the next one.
- Every removal shows a chip in the bottom left corner for a few seconds. Its Undo button brings that photo back.
- The panel in the bottom right corner sets the look of the mesh. Size is how large the photos are, from 50% to 200% of the size the window gives them. At 100% a window shows two rows in full and a part of the rows above and below. A phone shows one photo with a part of its neighbours when held upright, and one row when on its side. A cell is at most 320 px wide, so a large display shows more rows. Spacing is the space between photos, and Radius is how round their corners are. Both are a share of the photo width, so they look the same on every screen size. Hover picks what a photo does under the pointer: Lift, Zoom, Spotlight, Ring or Press. Background is the colour behind the photos.
- While Move photos is on, pan with the trackpad, by dragging the space between photos, or by holding Space while dragging.
- The minus and plus buttons zoom out and in.
- Undo is the Z key or Cmd+Z and covers moves and removals. Revert goes back to the last save. Save is Cmd+S or the Save button.

A removed photo leaves an empty cell until the next save. Save writes the order, the size, the spacing, the radius, the hover effect, the background colour and the list of removed photos to `src/gallery.json`, and lays the mesh out again without the empty cells. Each row closes its gaps towards the middle column, and the photos of the other rows stay where they are. A removed photo with likes also makes one photo of each lower count of likes jump inwards, so that the most liked photos keep the middle. The photos furthest from the middle, where the mesh repeats, can get new neighbours. Commit that file to keep it. Admin mode, likes included, is part of the dev server only and is not in the production build.

Save also deletes the image files of removed photos from `public/photos/`, and from then on Undo cannot bring them back. The import script skips removed photos. To restore one, delete its id from `removed` in `src/gallery.json` and run the import again.

## Deploy

The site is at https://photos.apraksin.xyz. A push to `main` deploys it. The workflow in `.github/workflows/deploy.yml` runs the tests, builds the site and copies `dist/` to the server. You can also start it by hand on the Actions page.

The image files are not in git, so the workflow does not carry them. Copy them from your computer:

```sh
npm run upload
```

This sends `public/photos/` to the server and removes from the server the files that are no longer in it. After an import, upload first and push second, so the page never asks for an image that is not there yet. After removing photos in admin mode the order does not matter.

### The server

One nginx container serves the site. It runs on a DigitalOcean droplet behind the Traefik proxy that is already there, and Traefik gets the certificate. `deploy/docker-compose.yml` and `deploy/nginx.conf` are the copies of the two files in `/srv/apraksin/compose` on the server. The same container serves the budget tracker at budget.apraksin.xyz, which has its own repository and its own deploy.

| On the server | What it holds | Who writes it |
| --- | --- | --- |
| `/srv/apraksin/photos/site` | the built site | the deploy workflow |
| `/srv/apraksin/photos/images` | `thumb/` and `full/` | `npm run upload` |
| `/srv/apraksin/compose` | the compose file and the nginx config | you, as root |

To change the server config, edit the files in `deploy/`, copy them to `/srv/apraksin/compose` and run `docker compose up -d` there. After a change to `nginx.conf` alone, run `docker compose restart web`.

The workflow logs in as the user `apraksin-deploy` with an SSH key that can only write files into `/srv/apraksin/photos/site`. It cannot open a shell or read anything. The repository holds two secrets for it:

- `DEPLOY_SSH_KEY` is the private key. Its public half is in `/srv/apraksin/.ssh/authorized_keys` on the server.
- `DEPLOY_KNOWN_HOSTS` is the host key of the server, as a `known_hosts` line. If the server is rebuilt, write the new one with `ssh-keyscan -t ed25519 photos.apraksin.xyz`.

The name `photos.apraksin.xyz` is delegated to the DigitalOcean name servers by three NS records at the registrar, and its A record is in DigitalOcean DNS. Traefik proves ownership of the name through DigitalOcean DNS when it asks for a certificate, which is why the name lives there.

## Tests

```sh
npm test
```
