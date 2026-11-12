"use client";

import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import RoomScene, { type PanState } from "./RoomScene";
import Overlay from "./Overlay";
import { books, type BookManifest } from "@/data/books";
import { initialReader, readerReducer } from "@/lib/reader";

const readable = books.find((b) => b.status === "published")!;

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

export default function StoryShelf() {
  const [state, dispatch] = useReducer(readerReducer, initialReader);
  const [manifest, setManifest] = useState<BookManifest | null>(null);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pan = useRef<PanState>({ x: 0, max: 0, metresPerPx: 0.003, init: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setWebgl(hasWebGL());
    setMuted(loadMuted());
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    fetch(`${readable.basePath}/manifest.json`)
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => setManifest(null));
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
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

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

  // Keyboard: in an RTL book, ArrowLeft is "next".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") dispatch({ type: "NEXT" });
      else if (e.key === "ArrowRight") dispatch({ type: "PREV" });
      else if (e.key === "Escape") {
        if (stateRef.current.focus) dispatch({ type: "UNFOCUS" });
        else closeBook();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Shelf scrolling: drag or wheel moves the camera along the shelf.
  const drag = useRef<{ id: number; x: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (stateRef.current.mode === "shelf") drag.current = { id: e.pointerId, x: e.clientX };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    pan.current.x -= (e.clientX - d.x) * pan.current.metresPerPx;
    d.x = e.clientX;
  };
  const endDrag = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    if (stateRef.current.mode !== "shelf") return;
    pan.current.x -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * pan.current.metresPerPx;
  };

  if (webgl === false || contextLost) {
    return (
      <main className="fallback" dir="rtl">
        <h1>رَفُّ الحِكايات</h1>
        <p>{contextLost ? "توقّف العرض ثلاثي الأبعاد. أعد تحميل الصفحة للمحاولة مرة أخرى." : "هذا الجهاز لا يدعم العرض ثلاثي الأبعاد، لكن يمكنك قراءة الكتاب."}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${readable.basePath}/pages/p01.webp`} alt="غلاف كتاب الأميرات الثلاث" />
        <a className="btn primary" href={`${readable.basePath}/The_Three_Princesses.pdf`} download>تحميل الكتاب (PDF)</a>
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
        onPointerCancel={endDrag}
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
                muted={muted}
                reducedMotion={reducedMotion}
                onLocked={onLocked}
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
        pdfHref={`${readable.basePath}/The_Three_Princesses.pdf`}
        totalPages={manifest?.pages.length ?? 30}
        toast={toast}
        onLocked={onLocked}
      />
    </main>
  );
}
