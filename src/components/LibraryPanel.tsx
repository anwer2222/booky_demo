"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isLocked, STAGES, type ShelfBook } from "@/data/books";

type Tab = "books" | "progress" | "new";
type Visibility = "public" | "private";

type Props = {
  books: ShelfBook[];
  onClose: () => void;
  onRead: (b: ShelfBook) => void;
  onLocked: (title: string) => void;
};

const VIS_AR: Record<Visibility, string> = { private: "لي فقط", public: "للجميع" };

// "My books" for a signed-in user: the books they can read, their stories being made into books,
// and a form to send a new story. Sending saves the title and author only; file upload comes later.
export default function LibraryPanel({ books, onClose, onRead, onLocked }: Props) {
  const [tab, setTab] = useState<Tab>("books");
  const submissions = useQuery(api.submissions.mine);
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
    ["progress", `قيد الإعداد${submissions?.length ? ` (${submissions.length})` : ""}`],
    ["new", "+ أضف قصة جديدة"],
  ];

  return (
    <div className="lib-backdrop" onClick={onClose}>
      <div
        className="lib"
        role="dialog"
        aria-modal="true"
        aria-label="مكتبتي"
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
                  <li key={b._id} className="card">
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
                        {b.pdf && <a className="btn small" href={`${b.basePath}/${b.pdf}`} download>PDF</a>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "progress" && (
            submissions === undefined ? (
              <p className="muted">جارٍ التحميل…</p>
            ) : submissions.length === 0 ? (
              <div className="empty">
                <p>لم ترسل أي قصة بعد.</p>
                <button className="btn primary" onClick={() => setTab("new")}>+ أضف قصة جديدة</button>
              </div>
            ) : (
              <ul className="lib-list">
                {submissions.map((s) => {
                  const at = STAGES.findIndex((x) => x.id === s.stage);
                  return (
                    <li key={s._id} className="card row">
                      <div className="card-text">
                        <h3>{s.title_ar}</h3>
                        <p className="muted">{s.child_ar} · {VIS_AR[s.visibility]}</p>
                        <p className="muted">أُرسلت في {new Date(s._creationTime).toLocaleDateString("ar", { day: "numeric", month: "long" })}</p>
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
            )
          )}

          {tab === "new" && <NewStoryForm onSent={() => setTab("progress")} />}
        </div>
      </div>
    </div>
  );
}

function NewStoryForm({ onSent }: { onSent: () => void }) {
  const create = useMutation(api.submissions.create);
  const [title, setTitle] = useState("");
  const [child, setChild] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = title.trim() && child.trim() && consent && !sending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSending(true);
    setError(null);
    try {
      await create({ title_ar: title, child_ar: child, visibility });
      onSent();
    } catch {
      setError("لم تُرسَل القصة، حاول مرة أخرى.");
      setSending(false);
    }
  };

  return (
    <form className="lib-form" onSubmit={submit}>
      <label>
        عنوان القصة
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="مثلًا: القطة التي أحبّت المطر" />
      </label>
      <label>
        اسم الكاتب الصغير وعمره
        <input type="text" value={child} onChange={(e) => setChild(e.target.value)} maxLength={80} placeholder="مثلًا: ليان، ٧ سنوات" />
      </label>
      <label className="drop">
        <input type="file" multiple accept=".txt,.docx,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((f) => f.name))} />
        <span className="drop-icon" aria-hidden>📄</span>
        <span>ملف القصة: نص (txt) أو وورد (docx) أو صور الصفحات المكتوبة بخط اليد</span>
        <span className="muted">رفع الملفات قريبًا. سنتواصل معك لاستلام القصة.</span>
        {files.length > 0 && <span className="muted">{files.join("، ")}</span>}
      </label>
      <fieldset>
        <legend>من يرى الكتاب؟</legend>
        <label className="radio"><input type="radio" name="vis" checked={visibility === "private"} onChange={() => setVisibility("private")} /> أنا فقط</label>
        <label className="radio"><input type="radio" name="vis" checked={visibility === "public"} onChange={() => setVisibility("public")} /> الجميع على الرف العام</label>
      </fieldset>
      <label className="radio">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> أنا وليّ الأمر، وأوافق على إرسال القصة
      </label>
      <p className="muted">الكتاب الأول مجاني. يصمّم فريقنا الكتاب يدويًا، وتتابع مراحله من «قيد الإعداد».</p>
      {error && <p className="note" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={!ready}>{sending ? "جارٍ الإرسال…" : "أرسل القصة"}</button>
    </form>
  );
}
