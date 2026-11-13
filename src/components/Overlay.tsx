"use client";

import { useEffect, useState, type Dispatch } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import LibraryPanel from "./LibraryPanel";
import type { ShelfBook } from "@/data/books";
import { canNext, canPrev, visiblePages, type ReaderAction, type ReaderState } from "@/lib/reader";

type Props = {
  state: ReaderState;
  dispatch: Dispatch<ReaderAction>;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  pdfHref: string;
  totalPages: number;
  toast: string | null;
  onLocked: (title: string) => void;
  books: ShelfBook[];
  onReadBook: (b: ShelfBook) => void;
  shelfPage: number;
  shelfPages: number;
  onTurnShelf: (dir: 1 | -1) => void;
  immersive: boolean;
  onImmersive: (on: boolean) => void;
};

// All interface text lives here, in the DOM, in Arabic (RTL).
export default function Overlay(p: Props) {
  const { state, dispatch } = p;
  const [library, setLibrary] = useState(false);
  const reading = state.mode === "table";
  const pages = visiblePages(state.turned);
  const where = !pages
    ? "الغلاف"
    : state.focus
      ? `صفحة ${state.focus === "right" ? pages.right : pages.left} من ${p.totalPages}`
      : `الصفحتان ${pages.right} و${pages.left} من ${p.totalPages}`;

  // On touch screens, explain the gestures once per visit when a book is first opened.
  const [gestureHint, setGestureHint] = useState(false);
  useEffect(() => {
    if (!reading || !matchMedia("(pointer: coarse)").matches) return;
    try {
      if (sessionStorage.getItem("gesture-hint")) return;
      sessionStorage.setItem("gesture-hint", "1");
    } catch { /* storage blocked: show it anyway */ }
    setGestureHint(true);
    const t = setTimeout(() => setGestureHint(false), 4500);
    return () => clearTimeout(t);
  }, [reading]);

  if (reading && p.immersive) {
    // full-screen reading: nothing but a small way back out
    return (
      <div className="overlay" dir="rtl">
        <button className="icon-btn exit-full" onClick={() => p.onImmersive(false)} aria-label="إظهار الأزرار">⤡</button>
      </div>
    );
  }

  return (
    <div className="overlay" dir="rtl">
      <header className="topbar">
        <h1 className="brand">رَفُّ الحِكايات</h1>
        <div className="top-tools">
          {state.mode === "shelf" && (
            <>
              <Show when="signed-in">
                <button className="btn" onClick={() => setLibrary(true)}>📚 كتبي</button>
                <UserButton />
              </Show>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="btn">تسجيل الدخول</button>
                </SignInButton>
              </Show>
            </>
          )}
          <button className="icon-btn" onClick={p.onToggleMute} aria-label={p.muted ? "تشغيل الصوت" : "كتم الصوت"} aria-pressed={p.muted}>
            {p.muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      {state.mode === "shelf" && (
        <>
          <div className="shelf-bar">
            <p className="hint-text">اضغطْ على كتاب لتقرأه، والْعبْ مع الألعاب!</p>
          </div>
          {p.shelfPages > 1 && (
            <>
              {/* RTL: the shelf continues to the left */}
              <button className="btn round shelf-arrow left" onClick={() => p.onTurnShelf(1)} disabled={p.shelfPage >= p.shelfPages - 1} aria-label="كتب أخرى">‹</button>
              <button className="btn round shelf-arrow right" onClick={() => p.onTurnShelf(-1)} disabled={p.shelfPage === 0} aria-label="الكتب السابقة">›</button>
            </>
          )}
        </>
      )}

      {reading && (
        <>
          <div className="top-actions">
            <button className="btn" onClick={p.onClose}>→ العودة إلى الرف</button>
            {p.pdfHref && <a className="btn" href={p.pdfHref} download>تحميل PDF</a>}
            {state.focus && (
              <button className="btn" onClick={() => dispatch({ type: "UNFOCUS" })}>عرض الصفحتين</button>
            )}
            <button className="btn" onClick={() => p.onImmersive(true)} aria-label="ملء الشاشة">⤢</button>
          </div>
          {gestureHint ? (
            <p className="hint small">اسحبْ يمينًا لتقلب الصفحة، وللأعلى لملء الشاشة</p>
          ) : (
            !state.focus && state.turned > 0 && !state.busy && <p className="hint small">اضغطْ على صفحة لتقرأها عن قرب</p>
          )}
          <nav className="pager" aria-label="التنقل بين الصفحات">
            <button className="btn round" onClick={() => dispatch({ type: "PREV" })} disabled={!canPrev(state)} aria-label="السابق">
              →
            </button>
            <span className="where" aria-live="polite">{where}</span>
            <button className="btn round primary" onClick={() => dispatch({ type: "NEXT" })} disabled={!canNext(state)} aria-label="التالي">
              ←
            </button>
          </nav>
        </>
      )}

      {library && state.mode === "shelf" && (
        <LibraryPanel
          books={p.books}
          onClose={() => setLibrary(false)}
          onRead={(b) => { setLibrary(false); p.onReadBook(b); }}
          onLocked={p.onLocked}
        />
      )}

      {p.toast && <div className="toast" role="status">{p.toast}</div>}
    </div>
  );
}
