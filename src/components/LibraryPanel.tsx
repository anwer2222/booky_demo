"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Sheet from "./Sheet";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_FILE_MB, MAX_FILES, MAX_TOTAL_MB, PAGE_OPTIONS, storyCharge, storyPrice } from "../../convex/pricing";
import { CATEGORIES, categoryLabel } from "../../convex/categories";
import { isLocked, lockLabel, STAGES, type ShelfBook } from "@/data/books";
import { addGuestToken } from "@/lib/guest";
import { usePay } from "@/lib/pay";
import { PaymentLogos, Price } from "./Price";

type Tab = "books" | "progress" | "new";
type Visibility = "public" | "private";

type Props = {
  books: ShelfBook[];
  onClose: () => void;
  onRead: (b: ShelfBook) => void;
  onLocked: (b: ShelfBook) => void;
  initialTab?: Tab;
};

const VIS_AR: Record<Visibility, string> = { private: "لي فقط", public: "للجميع" };

// "My books" for a signed-in user: the books they can read, their stories being made into books,
// and the form to send a new story.
export default function LibraryPanel({ books, onClose, onRead, onLocked, initialTab = "books" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const submissions = useQuery(api.submissions.mine);
  const { pay, paying, error } = usePay();

  return (
    <Sheet
      title="مكتبتي"
      tabs={[
        ["books", "كتبي"],
        ["progress", `قيد الإعداد${submissions?.length ? ` (${submissions.length})` : ""}`],
        ["new", "+ أضف قصة جديدة"],
      ]}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
    >
      {tab === "books" && (
        <ul className="lib-grid">
          {books.map((b) => {
            const locked = isLocked(b);
            return (
              <li key={b._id} className="card">
                <button className="card-cover" onClick={() => (locked ? onLocked(b) : onRead(b))} aria-label={b.title_ar}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.cover} alt="" loading="lazy" />
                  {locked && <span className="ribbon">{lockLabel(b)}</span>}
                </button>
                <div className="card-text">
                  <h3>{b.title_ar}</h3>
                  <p className="muted">{VIS_AR[b.visibility]}{b.category ? ` · ${categoryLabel(b.category)}` : ""}</p>
                </div>
                {locked ? (
                  <button className="btn small" disabled>{lockLabel(b)}</button>
                ) : (
                  <button className="btn small primary" onClick={() => onRead(b)}>اقرأ</button>
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
            {error && <p className="note" role="alert">{error}</p>}
            {submissions.map((s) => {
              const waiting = s.payment === "pending";
              const at = STAGES.findIndex((x) => x.id === s.stage);
              return (
                <li key={s._id} className="card row">
                  <div className="card-text">
                    <h3>{s.title_ar}</h3>
                    <p className="muted">{s.child_ar} · {VIS_AR[s.visibility]}{s.pages ? ` · ${s.pages} صفحة` : ""}{s.fileCount ? ` · ${s.fileCount} ملف` : ""}</p>
                    <p className="muted">
                      أُرسلت في {new Date(s._creationTime).toLocaleDateString("ar", { day: "numeric", month: "long" })}{" "}
                      {s.payment === "free" && <span className="badge ok">مجانية</span>}
                      {s.payment === "paid" && <span className="badge ok">مدفوعة</span>}
                      {waiting && <span className="badge wait">بانتظار الدفع</span>}
                    </p>
                  </div>
                  {waiting && s.orderId ? (
                    <button className="btn primary" disabled={paying} onClick={() => pay(s.orderId!)}>أكمل الدفع</button>
                  ) : (
                    <ol className="steps" aria-label="مراحل الإعداد">
                      {STAGES.map((st, i) => (
                        <li key={st.id} className={i < at ? "done" : i === at ? "now" : ""}>
                          <span className="dot">{i < at ? "✓" : i + 1}</span>
                          <span>{st.label_ar}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {tab === "new" && <NewStoryForm onSent={() => setTab("progress")} />}
    </Sheet>
  );
}

const STORY_ACCEPT = ".txt,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif";
const MB = 1024 * 1024;

/** The browser leaves .docx (and sometimes .heic) without a type; the server checks the type. */
function contentType(f: File) {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase();
  return ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : ext === "txt" ? "text/plain" : ext === "heic" ? "image/heic" : "application/octet-stream";
}

const FULL_AR = "نعمل الآن على قصص عائلات كثيرة، ولا نستقبل قصصًا جديدة مؤقتًا. عُد إلينا بعد أيام قليلة!";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The "new story" form. `guest`: sent without an account, so it asks for an email. */
export function NewStoryForm({ onSent, guest = false }: { onSent: () => void; guest?: boolean }) {
  const uploadUrl = useMutation(api.submissions.uploadUrl);
  const create = useMutation(api.submissions.create);
  const [email, setEmail] = useState("");
  const emailOk = EMAIL.test(email.trim());
  const firstFree = useQuery(api.submissions.firstIsFree, guest ? { email: emailOk ? email.trim() : undefined } : {}) ?? false;
  const canSend = useQuery(api.submissions.canSend, guest ? { email: emailOk ? email.trim() : undefined } : {}) ?? true;
  const { pay } = usePay();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [child, setChild] = useState("");
  const [pages, setPages] = useState<number>(20);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [hero, setHero] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = files.reduce((n, f) => n + f.size, 0) + (hero?.size ?? 0);
  const fileProblem =
    files.length > MAX_FILES ? `حتى ${MAX_FILES} ملفات فقط.`
      : [...files, ...(hero ? [hero] : [])].some((f) => f.size > MAX_FILE_MB * MB) ? `كل ملف أقل من ${MAX_FILE_MB} ميجابايت.`
        : total > MAX_TOTAL_MB * MB ? `الملفات معًا أقل من ${MAX_TOTAL_MB} ميجابايت.` : null;
  const charge = storyCharge(pages, firstFree);
  const ready = (!guest || emailOk) && child.trim() && files.length > 0 && !fileProblem && consent && !status && canSend;

  const upload = async (f: File) => {
    const res = await fetch(await uploadUrl(), { method: "POST", headers: { "Content-Type": contentType(f) }, body: f });
    if (!res.ok) throw new Error("upload failed");
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return { id: storageId, name: f.name };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      setStatus("جارٍ رفع الملفات…");
      const uploaded = await Promise.all(files.map(upload));
      const heroFile = hero ? await upload(hero) : undefined;
      setStatus("جارٍ الإرسال…");
      const { orderId, guestToken } = await create({
        title_ar: title, child_ar: child, visibility, pages, files: uploaded, hero: heroFile,
        category: category || undefined, email: guest ? email.trim() : undefined,
      });
      if (guestToken) addGuestToken(guestToken); // so this browser's shelf shows the new book
      if (orderId) {
        setStatus("جارٍ فتح صفحة الدفع…");
        await pay(orderId, guestToken); // on success the page moves to Moyasar; otherwise "أكمل الدفع" waits in the list
      }
      onSent();
    } catch (e) {
      setError(e instanceof ConvexError && e.data === "QUEUE_FULL" ? FULL_AR : "لم تُرسَل القصة، حاول مرة أخرى.");
      setStatus(null);
    }
  };

  return (
    <form className="lib-form" onSubmit={submit}>
      {guest && <p className="muted">لا تحتاج إلى حساب: نرسل التفاصيل إلى بريدك، وحين تسجّل بالبريد نفسه تجد كتبك كلها في حسابك.</p>}
      {!canSend && <p className="note" role="alert">{FULL_AR}</p>}
      {firstFree && <div className="free">🎁 قصتك الأولى مجانية حتى ٢٠ صفحة!</div>}
      {guest && (
        <label>
          بريد وليّ الأمر
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="email" placeholder="name@example.com" />
        </label>
      )}
      <label>
        عنوان القصة (اختياري)
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="مثلًا: القطة التي أحبّت المطر" />
      </label>
      <label>
        نوع القصة
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">اختر (اختياري)</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label_ar}</option>)}
        </select>
      </label>
      <label>
        اسم الكاتب الصغير وعمره
        <input type="text" value={child} onChange={(e) => setChild(e.target.value)} maxLength={80} placeholder="مثلًا: ليان، ٧ سنوات" />
      </label>
      <label className="drop">
        <input type="file" multiple accept={STORY_ACCEPT} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <span className="drop-icon" aria-hidden>📄</span>
        <span><b>ملفات القصة</b>: نص (txt) أو وورد (docx) أو صور الصفحات المكتوبة بخط اليد</span>
        <span className="muted">{files.length ? files.map((f) => f.name).join("، ") : `حتى ${MAX_FILES} ملفات`}</span>
      </label>
      <label className="drop">
        <input type="file" accept="image/*" onChange={(e) => setHero(e.target.files?.[0] ?? null)} />
        <span className="drop-icon" aria-hidden>🦸</span>
        <span><b>صورة البطل</b> (اختياري): رسمة طفلك للبطل، أو صورة نرسم البطل على شكلها</span>
        {hero && <span className="muted">{hero.name}</span>}
      </label>
      {fileProblem && <p className="note" role="alert">{fileProblem}</p>}
      <label>
        عدد صفحات الكتاب
        <select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
          {PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n} صفحة — {storyPrice(n)} ر.س</option>)}
        </select>
      </label>
      <fieldset>
        <legend>من يرى الكتاب؟</legend>
        <label className="radio"><input type="radio" name="vis" checked={visibility === "private"} onChange={() => setVisibility("private")} /> أنا فقط</label>
        <label className="radio"><input type="radio" name="vis" checked={visibility === "public"} onChange={() => setVisibility("public")} /> الجميع على الرف العام</label>
      </fieldset>
      <label className="radio">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> أنا وليّ الأمر، وأوافق على إرسال القصة وعلى الشروط والأحكام
      </label>
      <div className="price-box">
        <div className="price-row"><span>كتاب من {pages} صفحة</span><span><Price n={storyPrice(pages)} /></span></div>
        {firstFree && <div className="price-row"><span>خصم القصة الأولى</span><span>− <Price n={storyPrice(20)} /></span></div>}
        <div className="price-row total"><span>الإجمالي</span><span>{charge ? <Price n={charge} /> : "مجانًا"}</span></div>
      </div>
      {error && <p className="note" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={!ready}>{status ?? (charge ? <>أرسل القصة وادفع <Price n={charge} /></> : "أرسل القصة")}</button>
      {charge > 0 && <PaymentLogos />}
    </form>
  );
}
