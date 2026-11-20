"use client";

import { useEffect, useState, type Dispatch } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import LibraryPanel, { NewStoryForm } from "./LibraryPanel";
import Sheet from "./Sheet";
import InfoPanel from "./InfoPanel";
import StoryOptions from "./StoryOptions";
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
  onLocked: (b: ShelfBook) => void;
  books: ShelfBook[];
  openBook: ShelfBook | null;
  onReadBook: (b: ShelfBook) => void;
  category: string | null; // label of the toy category the shelf is showing, if any
  onClearCategory: () => void;
  immersive: boolean;
  onImmersive: (on: boolean) => void;
};

// All interface text lives here, in the DOM, in Arabic (RTL).
export default function Overlay(p: Props) {
  const { state, dispatch } = p;
  const [library, setLibrary] = useState<false | "books" | "new">(false);
  const [guestStory, setGuestStory] = useState(false);
  const [info, setInfo] = useState(false);
  const [options, setOptions] = useState(false);
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
        <h1 className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/raffy_logo.svg" alt="" />
          رَفُّ الحِكايات
        </h1>
        <div className="top-tools">
          {state.mode === "shelf" && (
            <button className="icon-btn" onClick={() => setInfo(true)} aria-label="عن رف الحكايات" title="عن رف الحكايات">🦉</button>
          )}
          {state.mode === "shelf" && (
            <>
              <Show when="signed-in">
                <button className="icon-btn add-story" onClick={() => setLibrary("new")} aria-label="أضف قصة جديدة" title="أضف قصة جديدة"><AddStoryIcon /></button>
                <button className="btn" onClick={() => setLibrary("books")}>📚 كتبي</button>
                <UserButton />
              </Show>
              <Show when="signed-out">
                <button className="icon-btn add-story" onClick={() => setGuestStory(true)} aria-label="أضف قصة جديدة" title="أضف قصة جديدة"><AddStoryIcon /></button>
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
            {p.category ? (
              <button className="btn small chip" onClick={p.onClearCategory} aria-label="عرض كل القصص">
                {p.category} <span aria-hidden>✕</span>
              </button>
            ) : (
              <p className="hint-text">اضغطْ على كتاب لتقرأه، وعلى لعبة لترى قصصها!</p>
            )}
          </div>
        </>
      )}

      {reading && (
        <>
          <div className="top-actions">
            <button className="btn" onClick={p.onClose}>→ العودة إلى الرف</button>
            {p.openBook && <button className="btn" onClick={() => setOptions(true)}>خيارات القصة</button>}
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
          initialTab={library}
          books={p.books}
          onClose={() => setLibrary(false)}
          onRead={(b) => { setLibrary(false); p.onReadBook(b); }}
          onLocked={p.onLocked}
        />
      )}

      {guestStory && state.mode === "shelf" && (
        <Sheet title="أضف قصة جديدة" onClose={() => setGuestStory(false)}>
          <NewStoryForm guest onSent={() => setGuestStory(false)} />
        </Sheet>
      )}

      {info && state.mode === "shelf" && <InfoPanel onClose={() => setInfo(false)} />}
      {options && reading && p.openBook && (
        <StoryOptions book={p.openBook} pdfHref={p.pdfHref} onClose={() => setOptions(false)} />
      )}

      {p.toast && <div className="toast" role="status">{p.toast}</div>}
    </div>
  );
}

/** A book with a plus: "add a new story". */
function AddStoryIcon() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <path d="M4 7c4-2 8-2 12 1v18c-4-3-8-3-12-1z" fill="#ffb703" stroke="#3b2a1e" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M28 7c-4-2-8-2-12 1v18c4-3 8-3 12-1z" fill="#fff6dc" stroke="#3b2a1e" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="24" cy="23" r="7" fill="#00a77a" stroke="#fff" strokeWidth="1.6" />
      <path d="M24 19.5v7M20.5 23h7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
