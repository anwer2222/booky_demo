"use client";

import { useState, type Dispatch } from "react";
import LibraryPanel from "./LibraryPanel";
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
};

// All interface text lives here, in the DOM, in Arabic (RTL).
export default function Overlay({ state, dispatch, muted, onToggleMute, onClose, pdfHref, totalPages, toast, onLocked }: Props) {
  const [library, setLibrary] = useState(false);
  const reading = state.mode === "table";
  const pages = visiblePages(state.turned);
  const where = !pages
    ? "الغلاف"
    : state.focus
      ? `صفحة ${state.focus === "right" ? pages.right : pages.left} من ${totalPages}`
      : `الصفحتان ${pages.right} و${pages.left} من ${totalPages}`;

  return (
    <div className="overlay" dir="rtl">
      <header className="topbar">
        <h1 className="brand">رَفُّ الحِكايات</h1>
        <div className="top-tools">
          {state.mode === "shelf" && (
            <button className="btn" onClick={() => setLibrary(true)}>📚 كتبي</button>
          )}
          <button className="icon-btn" onClick={onToggleMute} aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"} aria-pressed={muted}>
          {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      {state.mode === "shelf" && (
        <div className="shelf-bar">
          <p className="hint-text">اضغطْ على كتاب لتقرأه، والْعبْ مع الألعاب!</p>
          <button className="btn primary" onClick={() => dispatch({ type: "OPEN_BOOK" })}>اقرأ «الأميرات الثلاث»</button>
        </div>
      )}

      {reading && (
        <>
          <div className="top-actions">
            <button className="btn" onClick={onClose}>→ العودة إلى الرف</button>
            <a className="btn" href={pdfHref} download>تحميل PDF</a>
            {state.focus && (
              <button className="btn" onClick={() => dispatch({ type: "UNFOCUS" })}>عرض الصفحتين</button>
            )}
          </div>
          {!state.focus && state.turned > 0 && !state.busy && (
            <p className="hint small">اضغطْ على صفحة لتقرأها عن قرب</p>
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
          onClose={() => setLibrary(false)}
          onRead={() => { setLibrary(false); dispatch({ type: "OPEN_BOOK" }); }}
          onLocked={onLocked}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
