"use client";

import { useEffect, useRef, useState } from "react";
import { books, isLocked, STAGES, submissions, type ShelfBook } from "@/data/books";

type Tab = "books" | "progress" | "new";

type Props = {
  onClose: () => void;
  onRead: (b: ShelfBook) => void;
  onLocked: (title: string) => void;
};

const SOURCE_AR = { text: "ملف نصي", docx: "ملف وورد", handwriting: "صور بخط اليد" } as const;
const VIS_AR = { family: "للعائلة فقط", public: "للجميع" } as const;

// Mock-up of the "my books" area planned for the next phase: the reader's books, stories being made,
// and the form for sending a new story. Nothing here is saved or sent.
export default function LibraryPanel({ onClose, onRead, onLocked }: Props) {
  const [tab, setTab] = useState<Tab>("books");
  const [files, setFiles] = useState<string[]>([]);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const tabs: [Tab, string][] = [
    ["books", "كتبي"],
    ["progress", `قيد الإعداد (${submissions.length})`],
    ["new", "+ أضف قصة جديدة"],
  ];

  return (
    <div className="lib-backdrop" onClick={onClose}>
      <div
        className="lib"
        role="dialog"
        aria-modal="true"
        aria-label="كتبي"
        tabIndex={-1}
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <header className="lib-head">
          <h2>مكتبتي</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <nav className="lib-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="lib-body">
          {tab === "books" && (
            <ul className="lib-grid">
              {books.map((b) => {
                const locked = isLocked(b);
                return (
                  <li key={b.id} className="card">
                    <button className="card-cover" onClick={() => (locked ? onLocked(b.title_ar) : onRead(b))} aria-label={b.title_ar}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.cover} alt="" loading="lazy" />
                      {locked && <span className="ribbon">قريبًا</span>}
                    </button>
                    <div className="card-text">
                      <h3>{b.title_ar}</h3>
                      <p className="muted">{VIS_AR[b.visibility]}</p>
                    </div>
                    {locked ? (
                      <button className="btn small" disabled>قريبًا</button>
                    ) : (
                      <div className="card-actions">
                        <button className="btn small primary" onClick={() => onRead(b)}>اقرأ</button>
                        <a className="btn small" href={`${b.basePath}/The_Three_Princesses.pdf`} download>PDF</a>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "progress" && (
            <ul className="lib-list">
              {submissions.map((s) => {
                const at = STAGES.findIndex((x) => x.id === s.stage);
                return (
                  <li key={s.id} className="card row">
                    <div className="card-text">
                      <h3>{s.title_ar}</h3>
                      <p className="muted">{s.child_ar} · {SOURCE_AR[s.source]} · {VIS_AR[s.visibility]}</p>
                      <p className="muted">أُرسلت في {new Date(s.sent).toLocaleDateString("ar", { day: "numeric", month: "long", timeZone: "UTC" })}</p>
                    </div>
                    <ol className="steps" aria-label="مراحل الإعداد">
                      {STAGES.map((st, i) => (
                        <li key={st.id} className={i < at ? "done" : i === at ? "now" : ""}>
                          <span className="dot">{i < at ? "✓" : i + 1}</span>
                          <span>{st.label_ar}</span>
                        </li>
                      ))}
                    </ol>
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "new" && (
            <form className="lib-form" onSubmit={(e) => e.preventDefault()}>
              <p className="note">نسخة تجريبية: هذا النموذج للعرض فقط، ولن تُرسَل القصة.</p>
              <label>
                عنوان القصة
                <input type="text" placeholder="مثلًا: القطة التي أحبّت المطر" />
              </label>
              <label>
                اسم الكاتب الصغير وعمره
                <input type="text" placeholder="مثلًا: ليان، ٧ سنوات" />
              </label>
              <label className="drop">
                <input
                  type="file"
                  multiple
                  accept=".txt,.docx,image/*"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((f) => f.name))}
                />
                <span className="drop-icon" aria-hidden>📄</span>
                <span>اختر ملف القصة: نص (txt) أو وورد (docx) أو صور الصفحات المكتوبة بخط اليد</span>
                {files.length > 0 && <span className="muted">{files.join("، ")}</span>}
              </label>
              <fieldset>
                <legend>من يرى الكتاب؟</legend>
                <label className="radio"><input type="radio" name="vis" defaultChecked /> العائلة فقط</label>
                <label className="radio"><input type="radio" name="vis" /> الجميع على الرف العام</label>
              </fieldset>
              <label className="radio">
                <input type="checkbox" /> أنا وليّ الأمر، وأوافق على إرسال القصة
              </label>
              <p className="muted">الكتاب الأول مجاني. يصمّم فريقنا الكتاب يدويًا، وتتابع مراحله من «قيد الإعداد».</p>
              <button className="btn primary" type="submit" disabled>أرسل القصة (قريبًا)</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
