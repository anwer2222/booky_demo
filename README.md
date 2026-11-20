# رف الحكايات — 3D story shelf demo

Arabic (RTL) demo: a 3D room with a bookshelf, two readable books (*The Three Princesses*, *Laila and the Golden Falcon*), two "coming soon" books and nine clickable toys. Accounts with Clerk (email or Google), data in Convex, emails through Gmail. No payments and no file uploads yet.

## Run

```sh
npm install
npx convex dev       # terminal 1: Convex backend (asks you to log in and pick a project the first time)
npm run dev          # terminal 2: http://localhost:3000
npx convex run books:seed   # once: puts the 4 demo books in the database
```

`npm run build` and `npm run dev` share `.next/`, so stop the dev server before building. Deploy as a normal Next.js app (for example on Vercel); Clerk needs the middleware, so it is no longer a static export.

### Settings

`.env` (Next.js, not committed):
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: from the Clerk dashboard.
- `NEXT_PUBLIC_CONVEX_URL`: written to `.env.local` by `npx convex dev`.

Convex environment variables (`npx convex env set NAME value`, or the Convex dashboard):
- `CLERK_JWT_ISSUER_DOMAIN`: the Clerk Frontend API URL, e.g. `https://optimum-mosquito-9363.clerk.accounts.dev`.
- `GMAIL_USER`: the sending Gmail address (dreptecc@gmail.com).
- `GMAIL_FROM` (optional): the From address, e.g. a `no-reply@` alias. It must be a verified "Send mail as" alias of `GMAIL_USER` in Gmail settings. Defaults to `GMAIL_USER`.
- `REPLY_TO` (optional): where replies go. Defaults to `GMAIL_USER`.
- `GMAIL_APP_PASSWORD`: a Google *app password* for that account (Google Account → Security → 2-Step Verification → App passwords). Until it is set, emails are written to the Convex log instead of sent.
- `ADMIN_EMAIL`: who gets "new story" emails (defaults to `GMAIL_USER`).
- `MOYASAR_SECRET_KEY`: Moyasar secret key (`sk_test_...` while testing). Without it, the pay buttons say payments are not active yet.
- `SITE_URL`: where Moyasar sends the customer back after paying (`http://localhost:3000` in development, the real domain in production).

Clerk needs a JWT template named `convex` (claims `aud: "convex"`, `name`, `email`). It already exists in the development instance; a production instance needs its own.

### Data (`convex/`)

- `books`: the shelf. Everyone sees `public` books; signed-in users also see their own `private` ones. `npx convex run books:seed` resets the 4 demo books.
- `users`: created on first sign-in (`users.store`), which also sends the welcome email.
- **Guests:** stories and print orders work without an account, with an email. Each guest story/order gets a secret `guestToken` (kept in the browser's localStorage so the shelf shows their books, and added to the Moyasar return link as `&g=`). Signing up with the same email links everything to the account (`users.store`). The free first story is counted per account *and* per email.
- **Categories:** 7, one per toy on the toy shelf (`convex/categories.ts`). Tapping a toy shows only its books. Set a book's category with `npx convex run books:setCategory '{"slug":"laila","category":"travel"}'`.
- **New stories on the shelf:** sending a story adds a private `processing` book (template cover `public/covers/processing.webp`, title «قصتي الجديدة» if none, ribbon «قيد الإعداد»). To publish it, set its `status`, `basePath`, `pdf`, `cover` (and `visibility` if the family chose public) in the dashboard.
- `submissions`: stories sent from the book-and-plus button or «📚 كتبي» → «أضف قصة جديدة»: story files (txt, docx or photos), an optional hero picture (stored in Convex file storage), page count and price. The admin email carries the files as attachments. Move a story through its stages (received → writing → illustrating → ready) by editing `stage` in the Convex dashboard.
- `orders`: payments. Story orders (when the story is not free) and printed copies (from «خيارات القصة» in the reader, optionally as a gift).

### Prices and payments

- Prices live in one file, `convex/pricing.ts`, used both to charge and to display. First story free (20 pages); 20 pages 25 SAR, 30 pages 40 SAR, then 2 SAR a page. **Print prices there are placeholders** (79 SAR a copy, 25 SAR delivery, 10 SAR gift wrap).
- Payment uses Moyasar hosted invoices (`convex/payments.ts`): the server creates the invoice for the amount it worked out, the customer pays on Moyasar's page (Arabic), and comes back to `/?order=<id>`. The order counts as paid only after the server reads the invoice back from Moyasar as `paid` with the right amount. Moyasar also POSTs to `<CONVEX_SITE_URL>/moyasar/callback` (`convex/http.ts`), so a payment is recorded even if the customer closes the tab.
- On payment: the customer gets a receipt email; the admin gets the story (with attachments) or the print order with the delivery address.

## Where things come from

| Path | Made by |
|---|---|
| `public/models/story_room.glb` | Blender: `../assets-src/blender/story_room.blend` (see `../assets/README.md` for node names) |
| `public/books/three-princesses/` | `python3 build/make_book.py && python3 build/make_book_package.py three-princesses` (run from the story folder) |
| `public/books/laila/` | `python3 build/make_book_lila.py && python3 build/make_book_package.py laila` (sources in `../books_src/laila/`) |
| `public/covers/` | Placeholder covers for the "coming soon" books, from `../assets-src/textures/cover_*.png` |
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
- **New books:** a new book is a PDF plus a manifest, and a row in `books`. No Blender export is needed. Books can have any even number of pages up to 30; the 3D book shows only as many leaves as the book has.

## Controls

- **Shelf:** 4 books at a time. The ‹ › arrows (or ArrowLeft / ArrowRight) show the next 4; the books tip forward and come back up with new covers. Tap a book to read it, tap a toy to make it jump, spin, glow and throw stars.
- **Phone, while reading:** swipe right for the next page, left for the previous one. Swipe up hides every button (full-screen reading); swipe down, or the small ⤡ button, brings them back. On Android the browser bars hide too; iPhone Safari does not allow that.
- **Sound:** each page turn makes a paper sound (the cover a heavier one); the 🔊 button mutes everything.
- **Book:** ← is next and → is previous (RTL). On a keyboard, ArrowLeft is next and ArrowRight is previous.
- **Page focus:** tap a page to zoom in on it. "Next" moves to the left page first, then turns the page.
- **Leaving:** Escape or the phone's Back button leaves page focus, then closes the book.
