# رف الحكايات — 3D story shelf demo

Arabic (RTL) demo: a 3D room with a bookshelf, one readable book (*The Three Princesses*), four "coming soon" books and nine clickable toys (five kinds, some copied). No backend, accounts or payments.

## Run

```sh
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in out/ (host on any static host)
```

## Where things come from

| Path | Made by |
|---|---|
| `public/models/story_room.glb` | Blender: `../assets-src/blender/story_room.blend` (see `../assets/README.md` for node names) |
| `public/books/three-princesses/` | `python3 build/make_book.py && python3 build/make_book_package.py` (run from the story folder) |
| `public/draco/` | Copied from `node_modules/three/examples/jsm/libs/draco/gltf/` |

## Code

- `src/lib/reader.ts`: the reading state machine (shelf → table → spread / page focus). The 3D scene and the buttons both read it.
- `src/lib/bookRig.ts`: the readable book.
  - Two page stacks that shrink and grow as you read.
  - Leaves that bend while turning. Each leaf is rebuilt as a 40 × 12 grid so the reader-side corner can lift first and lead the rest of the page.
  - Paper shading that darkens towards the spine.
  - Endpapers inside both covers.
- `src/components/RoomScene.tsx`:
  - Loads the model and works on a fresh copy each time. React builds twice in development; editing the cached model in place was the cause of "model is missing node".
  - Keeps page images in memory only for the spreads near the open one.
  - Animates the book move, toys and camera. Three shelf-side views:
    - **Main:** the shelves fill about 90% of the screen width.
    - **Look down:** on a laptop, moving the mouse to the bottom of the screen tilts the camera down to the reading table. The mouse also adds a little sideways parallax.
    - **Wide:** while the book flies between shelf and table, the camera pulls back to show both, then moves in to the book.
  - Picks clicks and hovers from the nearest *visible* hit. three.js also hits hidden objects, and the hidden table book stands in front of the shelf copy in slot 1, which made that book unclickable.
  - Hovered shelf books lean out a little and show their title.
- `src/lib/toyFx.ts`: toy taps: squash-and-hop spring, glow (emissive plus a soft halo behind the toy) and a burst of coloured stars. Textures are drawn on canvases.
- `src/components/StoryShelf.tsx`: canvas, input (drag/wheel to scroll the shelf, keys, Back button), WebGL fallback.
- `src/components/Overlay.tsx`: all Arabic UI text and buttons (DOM, not 3D).
- `src/components/LibraryPanel.tsx`: mock-up of the next phase's "My books" area, opened from «📚 كتبي». Tabs: the books as cards (read / PDF / coming soon), stories in progress with their stages, and a form to send a new story. Nothing is saved or sent; the in-progress stories are sample data in `src/data/books.ts` (`submissions`).
- `src/data/books.ts`: shelf contents, shaped like the future Convex `books` records.

## Why pages are images loaded at runtime, not baked into the 3D model

- **Size:** the model stays small (~730 KB). Pages load spread by spread, about 100 KB each.
- **Memory:** an iPhone only ever holds about 10 page images in memory.
- **New books:** a new book is a PDF plus a manifest. No Blender export is needed, which matters once admins upload books.

Note: `npm run build` and `npm run dev` share `.next/`, so stop the dev server before building.

## Controls

- **Shelf:** tap a book or the "اقرأ" button to read it, tap a toy to make it jump, spin, glow and throw stars, and drag or scroll to move along the shelf.
- **Book:** ← is next and → is previous (RTL). On a keyboard, ArrowLeft is next and ArrowRight is previous.
- **Page focus:** tap a page to zoom in on it. "Next" moves to the left page first, then turns the page.
- **Leaving:** Escape or the phone's Back button leaves page focus, then closes the book.
