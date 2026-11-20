"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import Sheet from "./Sheet";
import { api } from "../../convex/_generated/api";
import { GIFT_WRAP, MAX_COPIES, PRINT_COPY, PRINT_SHIPPING, printCharge } from "../../convex/pricing";
import type { ShelfBook } from "@/data/books";
import { usePay } from "@/lib/pay";
import { PaymentLogos, Price } from "./Price";

type Props = { book: ShelfBook; pdfHref: string; onClose: () => void };

/** Options for the open book: download the PDF, or order printed copies (for the reader or as a gift). */
export default function StoryOptions({ book, pdfHref, onClose }: Props) {
  const [tab, setTab] = useState<"print" | "pdf">("print");
  return (
    <Sheet title={`خيارات «${book.title_ar}»`} tabs={[["print", "📖 نسخة مطبوعة"], ["pdf", "⬇️ تحميل PDF"]]} tab={tab} onTab={setTab} onClose={onClose}>
      {tab === "pdf" ? (
        <div className="opt-card">
          <h3>نسخة رقمية</h3>
          <p>حمّل الكتاب كاملًا بصيغة PDF لتقرأه دون اتصال أو تطبعه في البيت.</p>
          <a className="btn primary" href={pdfHref} download>تحميل PDF (مجانًا)</a>
        </div>
      ) : (
        <PrintForm book={book} />
      )}
    </Sheet>
  );
}

function PrintForm({ book }: { book: ShelfBook }) {
  const { isSignedIn } = useAuth();
  const createPrint = useMutation(api.orders.createPrint);
  const { pay, paying, error: payError } = usePay();
  const [f, setF] = useState({ copies: 1, gift: false, giftTo: "", giftMessage: "", name: "", phone: "", city: "", address: "" });
  const [email, setEmail] = useState(""); // guests only
  const guest = !isSignedIn;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }));
  const total = printCharge(f.copies, f.gift);
  const phoneOk = /^\+?[0-9 ]{9,15}$/.test(f.phone.trim());
  const ready = (!guest || emailOk) && f.name.trim() && phoneOk && f.city.trim() && f.address.trim() && (!f.gift || f.giftTo.trim()) && !paying;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      const { orderId, guestToken } = await createPrint({
        bookId: book._id, ...f, giftTo: f.giftTo || undefined, giftMessage: f.giftMessage || undefined,
        email: guest ? email.trim() : undefined,
      });
      await pay(orderId, guestToken);
    } catch {
      setError("لم يُحفظ الطلب، تأكد من البيانات وحاول مرة أخرى.");
    }
  };

  return (
    <form className="lib-form" onSubmit={submit}>
      {guest && (
        <label>
          بريدك (للإيصال ومتابعة الطلب، دون الحاجة إلى حساب)
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="email" placeholder="name@example.com" />
        </label>
      )}
      <label>
        عدد النسخ
        <select value={f.copies} onChange={(e) => set("copies", Number(e.target.value))}>
          {Array.from({ length: MAX_COPIES }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="radio">
        <input type="checkbox" checked={f.gift} onChange={(e) => set("gift", e.target.checked)} /> 🎁 هذا الطلب هدية (تغليف ورسالة، +<Price n={GIFT_WRAP} />)
      </label>
      {f.gift && (
        <>
          <label>اسم من تهديه<input type="text" value={f.giftTo} onChange={(e) => set("giftTo", e.target.value)} maxLength={80} /></label>
          <label>رسالة الهدية (اختياري)<textarea value={f.giftMessage} onChange={(e) => set("giftMessage", e.target.value)} maxLength={300} /></label>
        </>
      )}
      <fieldset>
        <legend>{f.gift ? "عنوان المُهدى إليه" : "عنوان التوصيل"}</legend>
        <div className="row2">
          <label>الاسم<input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} autoComplete="name" /></label>
          <label>رقم الجوال<input type="tel" dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="05xxxxxxxx" maxLength={20} autoComplete="tel" /></label>
        </div>
        <label>المدينة<input type="text" value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={60} /></label>
        <label>العنوان (الحي، الشارع، رقم المبنى)<input type="text" value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={300} autoComplete="street-address" /></label>
      </fieldset>
      <div className="price-box">
        <div className="price-row"><span>{f.copies} × نسخة</span><span><Price n={f.copies * PRINT_COPY} /></span></div>
        <div className="price-row"><span>التوصيل</span><span><Price n={PRINT_SHIPPING} /></span></div>
        {f.gift && <div className="price-row"><span>تغليف هدية</span><span><Price n={GIFT_WRAP} /></span></div>}
        <div className="price-row total"><span>الإجمالي</span><span><Price n={total} /></span></div>
      </div>
      {(error || payError) && <p className="note" role="alert">{error ?? payError}</p>}
      <button className="btn primary" type="submit" disabled={!ready}>{paying ? "جارٍ فتح صفحة الدفع…" : <>ادفع <Price n={total} /></>}</button>
      <PaymentLogos />
      <p className="muted">ستنتقل إلى صفحة الدفع الآمنة لدى ميسّر، ثم تعود إلى الرف.</p>
    </form>
  );
}
