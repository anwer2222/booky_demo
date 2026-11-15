"use client";

import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import * as THREE from "three";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import RoomScene, { type PanState } from "./RoomScene";
import Overlay from "./Overlay";
import { isLocked, SHELF_SLOTS, type BookManifest, type ShelfBook } from "@/data/books";
import { initialReader, leavesFor, readerReducer } from "@/lib/reader";

const SWIPE_PX = 60; // finger travel that counts as a swipe

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function loadMuted() {
  try {
    return localStorage.getItem("story-shelf-muted") === "1";
  } catch {
    return false;
  }
}

async function fetchManifest(book: ShelfBook) {
  return (await (await fetch(`${book.basePath}/manifest.json`)).json()) as BookManifest;
}

export default function StoryShelf() {
  const [state, dispatch] = useReducer(readerReducer, initialReader);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [immersive, setImmersive] = useState(false); // reading with every button hidden
  const pan = useRef<PanState>({ x: 0, max: 0, metresPerPx: 0.003, init: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  // Signed-in users get a row in Convex (and a welcome email the first time).
  const { isAuthenticated } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  useEffect(() => {
    if (isAuthenticated) storeUser().catch(() => { /* tried again on the next sign-in */ });
  }, [isAuthenticated, storeUser]);

  // Back from Moyasar's payment page (/?order=<id>): confirm the payment with the server.
  const verify = useAction(api.payments.verify);
  useEffect(() => {
    const orderId = new URLSearchParams(location.search).get("order");
    if (!orderId || !isAuthenticated) return;
    history.replaceState(null, "", location.pathname);
    verify({ orderId: orderId as Id<"orders"> })
      .then((status) => setToast(
        status === "paid" ? "تم الدفع، شكرًا لك! أرسلنا التفاصيل إلى بريدك."
          : status === "failed" ? "لم يكتمل الدفع. يمكنك المحاولة مرة أخرى من «كتبي»." : "لم يكتمل الدفع بعد.",
      ))
      .catch(() => setToast("تعذّر التحقق من الدفع، سنراجعه ونعلمك بالبريد."));
  }, [isAuthenticated, verify]);

  // Books: public ones plus the user's own, SHELF_SLOTS at a time; arrows scroll the shelf.
  const books = useQuery(api.books.list);
  const all = books ?? [];
  const [offset, setOffset] = useState(0);
  const pages = Math.max(1, Math.ceil(all.length / SHELF_SLOTS));
  const shelfPage = Math.min(offset / SHELF_SLOTS, pages - 1);
  const shelf = Array.from({ length: SHELF_SLOTS }, (_, i) => all[shelfPage * SHELF_SLOTS + i] ?? null);
  const turnShelf = useCallback((dir: 1 | -1) => {
    if (stateRef.current.mode !== "shelf") return;
    setOffset((o) => Math.max(0, Math.min((pages - 1) * SHELF_SLOTS, o + dir * SHELF_SLOTS)));
  }, [pages]);

  // The open book: which slot it came from and its manifest (page list, PDF, cover colour).
  const [open, setOpen] = useState<{ book: ShelfBook; slot: number } | null>(null);
  const [manifest, setManifest] = useState<BookManifest | null>(null);
  const manifests = useRef(new Map<string, BookManifest>());
  const openBook = useCallback(async (book: ShelfBook, slot: number) => {
    if (stateRef.current.mode !== "shelf" || isLocked(book)) return;
    let m = manifests.current.get(book.slug);
    if (!m) {
      try {
        m = await fetchManifest(book);
        manifests.current.set(book.slug, m);
      } catch {
        setToast("تعذّر فتح الكتاب، حاول مرة أخرى");
        return;
      }
    }
    setOpen({ book, slot });
    setManifest(m);
    dispatch({ type: "OPEN_BOOK", leaves: leavesFor(m.pages.length) });
  }, []);
  const onPick = useCallback((slot: number) => {
    const b = shelf[slot];
    if (b) void openBook(b, slot);
  }, [shelf, openBook]);
  /** From the "my books" list: scroll the shelf to the book first, then take it down. */
  const readFromList = useCallback((book: ShelfBook) => {
    const i = all.findIndex((b) => b._id === book._id);
    if (i < 0) return;
    const page = Math.floor(i / SHELF_SLOTS);
    if (page === shelfPage) return void openBook(book, i % SHELF_SLOTS);
    setOffset(page * SHELF_SLOTS);
    setTimeout(() => void openBook(book, i % SHELF_SLOTS), 900); // after the covers have flipped
  }, [all, shelfPage, openBook]);

  useEffect(() => {
    setWebgl(hasWebGL());
    setMuted(loadMuted());
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      try { localStorage.setItem("story-shelf-muted", m ? "0" : "1"); } catch { /* storage blocked */ }
      return !m;
    });
  };

  const onLocked = useCallback((title: string) => {
    setToast(`«${title}» قريبًا!`);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.length > 30 ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Full-screen reading: hides every button. It ends when the book goes back to the shelf.
  const setFullscreen = useCallback((on: boolean) => {
    setImmersive(on);
    try {
      // Android and desktop browsers can also hide their own bars; iPhone Safari cannot, so this may do nothing.
      if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    } catch { /* not supported */ }
  }, []);
  useEffect(() => {
    if (state.mode !== "table" && immersive) setFullscreen(false);
  }, [state.mode, immersive, setFullscreen]);

  // Phone/browser Back closes page focus, then the book, instead of leaving the site.
  useEffect(() => {
    if (state.mode === "toTable") history.pushState({ reading: true }, "");
  }, [state.mode]);
  useEffect(() => {
    const onPop = () => {
      const s = stateRef.current;
      if (s.focus) {
        dispatch({ type: "UNFOCUS" });
        history.pushState({ reading: true }, "");
      } else {
        dispatch({ type: "CLOSE_BOOK" });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const closeBook = () => {
    if (history.state?.reading) history.replaceState(null, "");
    dispatch({ type: "CLOSE_BOOK" });
  };

  // Keyboard: in an RTL book, ArrowLeft is "next" (the next page, or the next shelf of books).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, .lib")) return;
      const onShelf = stateRef.current.mode === "shelf";
      if (e.key === "ArrowLeft") {
        if (onShelf) turnShelf(1);
        else dispatch({ type: "NEXT" });
      } else if (e.key === "ArrowRight") {
        if (onShelf) turnShelf(-1);
        else dispatch({ type: "PREV" });
      } else if (e.key === "Escape") {
        if (stateRef.current.focus) dispatch({ type: "UNFOCUS" });
        else closeBook();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turnShelf]);

  // Shelf: drag or wheel moves the camera along the shelf (phones). Reading: swipe to turn pages
  // (finger to the right = next, as in an Arabic book), swipe up to hide the buttons, down to show them.
  const drag = useRef<{ id: number; x: number; x0: number; y0: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, x: e.clientX, x0: e.clientX, y0: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || stateRef.current.mode !== "shelf") return;
    pan.current.x -= (e.clientX - d.x) * pan.current.metresPerPx;
    d.x = e.clientX;
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || stateRef.current.mode !== "table") return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) dispatch({ type: dx > 0 ? "NEXT" : "PREV" });
    else if (Math.abs(dy) > SWIPE_PX && Math.abs(dy) > 1.5 * Math.abs(dx)) setFullscreen(dy < 0);
  };
  const cancelDrag = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    if (stateRef.current.mode !== "shelf") return;
    pan.current.x -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * pan.current.metresPerPx;
  };

  if (webgl === false || contextLost) {
    return (
      <main className="fallback" dir="rtl">
        <h1>رَفُّ الحِكايات</h1>
        <p>{contextLost ? "توقّف العرض ثلاثي الأبعاد. أعد تحميل الصفحة للمحاولة مرة أخرى." : "هذا الجهاز لا يدعم العرض ثلاثي الأبعاد، لكن يمكنك قراءة الكتب."}</p>
        {all.filter((b) => !isLocked(b)).map((b) => (
          <section key={b._id} className="fallback">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.cover} alt={`غلاف كتاب ${b.title_ar}`} />
            <button className="btn primary" onClick={async () => {
              const m = await fetchManifest(b);
              location.href = `${b.basePath}/${m.pdf}`;
            }}>تحميل «{b.title_ar}» (PDF)</button>
          </section>
        ))}
      </main>
    );
  }

  return (
    <main className="stage">
      <div
        className="canvas-wrap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onWheel={onWheel}
      >
        {webgl && (
          <Canvas
            dpr={[1, 2]}
            flat
            shadows="soft"
            gl={{ antialias: true, powerPreference: "high-performance" }}
            camera={{ fov: 45, near: 0.01, far: 30, position: [0, 1.4, 3] }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.domElement.addEventListener("webglcontextlost", (ev) => { ev.preventDefault(); setContextLost(true); });
            }}
          >
            <color attach="background" args={["#d9c6a5"]} />
            <ambientLight intensity={0.85} />
            <hemisphereLight args={["#fff4e0", "#7a5a3a", 0.9]} />
            {/* one shadow-casting light covers the shelf and the table; 2048 px keeps page shadows crisp */}
            <directionalLight
              position={[-0.9, 3.2, 3.0]}
              intensity={1.9}
              color="#ffe4c4"
              castShadow
              shadow-intensity={0.6}
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0004}
              shadow-normalBias={0.015}
              shadow-camera-left={-1.7}
              shadow-camera-right={1.7}
              shadow-camera-top={1.6}
              shadow-camera-bottom={-1.2}
              shadow-camera-near={1}
              shadow-camera-far={7}
            />
            <pointLight position={[-0.6, 1.12, 0.74]} intensity={0.8} distance={2.5} color="#ffd29a" />
            <Suspense fallback={null}>
              <RoomScene
                state={state}
                dispatch={dispatch}
                manifest={manifest}
                basePath={open?.book.basePath ?? ""}
                shelf={shelf}
                openSlot={open?.slot ?? 0}
                muted={muted}
                reducedMotion={reducedMotion}
                onLocked={onLocked}
                onPick={onPick}
                pan={pan}
              />
            </Suspense>
          </Canvas>
        )}
      </div>
      <Overlay
        state={state}
        dispatch={dispatch}
        muted={muted}
        onToggleMute={toggleMute}
        onClose={closeBook}
        pdfHref={open && manifest ? `${open.book.basePath}/${manifest.pdf}` : ""}
        totalPages={manifest?.pages.length ?? 0}
        toast={toast}
        onLocked={onLocked}
        books={all}
        openBook={open?.book ?? null}
        onReadBook={readFromList}
        shelfPage={shelfPage}
        shelfPages={pages}
        onTurnShelf={turnShelf}
        immersive={immersive}
        onImmersive={setFullscreen}
      />
    </main>
  );
}
