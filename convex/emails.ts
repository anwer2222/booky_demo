"use node";
// Emails go out through Gmail SMTP with an app password (Google account → Security → App passwords).
// Convex environment variables:
//   GMAIL_USER          the sending address, e.g. dreptecc@gmail.com
//   GMAIL_APP_PASSWORD  16-character app password for that account
//   ADMIN_EMAIL         where "new story" and "print order" emails go (defaults to GMAIL_USER)
// Without GMAIL_APP_PASSWORD the email is logged and skipped, so the app still works.

import nodemailer from "nodemailer";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { LOGO_PNG_BASE64 } from "./logo";

type Attachment = { filename: string; content: Buffer; cid?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const sar = (halalas: number) => `${(halalas / 100).toLocaleString("ar-SA")} ر.س`;

// Mail apps drop <html dir>, so direction is set on every block, inline, and `dir` on the table.
const RTL = "direction:rtl;text-align:right;unicode-bidi:embed";

function page(body: string) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"></head>
<body dir="rtl" style="margin:0;padding:0;background:#fbf5e9;${RTL}">
<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf5e9;${RTL}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:16px;border:2px solid #00d79d;${RTL}">
<tr><td dir="rtl" style="padding:24px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.9;color:#3b2a1e;${RTL}">
${body}
<table role="presentation" dir="rtl" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #eee;padding-top:16px;${RTL}"><tr>
<td style="padding-left:12px"><img src="cid:logo" width="64" height="64" alt="رف الحكايات" style="display:block"></td>
<td dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#6b5a48;${RTL}">مع الحب،<br><b style="color:#1f6f76">فريق رف الحكايات</b></td>
</tr></table>
</td></tr></table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p dir="rtl" style="margin:0 0 12px;${RTL}">${html}</p>`;
const list = (rows: [string, string | undefined][]) =>
  `<ul dir="rtl" style="margin:0 0 12px;padding-right:20px;padding-left:0;${RTL}">${rows
    .filter(([, val]) => val)
    .map(([k, val]) => `<li style="${RTL}"><b>${k}:</b> ${esc(val!)}</li>`)
    .join("")}</ul>`;

async function send(to: string, subject: string, body: string, attachments: Attachment[] = []) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log(`email skipped (GMAIL_USER / GMAIL_APP_PASSWORD not set): "${subject}" to ${to}, ${attachments.length} attachments`);
    return;
  }
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transport.sendMail({
    from: `"رف الحكايات" <${user}>`,
    to,
    subject,
    html: page(body),
    attachments: [{ filename: "logo.png", content: Buffer.from(LOGO_PNG_BASE64, "base64"), cid: "logo" }, ...attachments],
  });
}

const admin = () => process.env.ADMIN_EMAIL ?? process.env.GMAIL_USER;

async function file(ctx: ActionCtx, f: { id: Id<"_storage">; name: string }): Promise<Attachment | null> {
  const blob = await ctx.storage.get(f.id);
  return blob ? { filename: f.name, content: Buffer.from(await blob.arrayBuffer()) } : null;
}

export const welcome = internalAction({
  args: { to: v.string(), name: v.string() },
  handler: async (_ctx, { to, name }) => {
    await send(to, "أهلًا بك في رف الحكايات!", [
      p(name ? `مرحبًا ${esc(name)}،` : "مرحبًا،"),
      p("سعداء بانضمامك إلى رف الحكايات! اقرأ القصص على الرف، وحين يكتب طفلك قصته، أرسلها إلينا من «كتبي» وسنحوّلها إلى كتاب مصوّر جميل."),
      p("<b>القصة الأولى مجانية</b> (حتى ٢٠ صفحة)."),
    ].join(""));
  },
});

/** To the admin, with the story files and the hero picture attached. */
export const newStory = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const data = await ctx.runQuery(internal.submissions.forEmail, { submissionId });
    const to = admin();
    if (!data || !to) return;
    const { s, email, amount } = data;
    const files = (await Promise.all((s.files ?? []).map((f) => file(ctx, f)))).filter((a): a is Attachment => !!a);
    const hero = s.hero ? await file(ctx, { ...s.hero, name: `البطل - ${s.hero.name}` }) : null;
    await send(to, `قصة جديدة: ${s.title_ar}`, [
      p("وصلت قصة جديدة لتحويلها إلى كتاب:"),
      list([
        ["العنوان", s.title_ar],
        ["الكاتب", s.child_ar],
        ["عدد الصفحات", s.pages ? String(s.pages) : undefined],
        ["الظهور", s.visibility === "public" ? "للجميع" : "خاص بالعائلة"],
        ["الدفع", amount ? `مدفوع ${sar(amount)}` : "القصة الأولى (مجانية)"],
        ["البريد", email],
      ]),
      p(`المرفقات: ${files.length} ملف${hero ? " وصورة البطل" : ""}.`),
    ].join(""), hero ? [...files, hero] : files);
  },
});

/** To the admin: where to print and send the book. */
export const printOrder = internalAction({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const data = await ctx.runQuery(internal.orders.forEmail, { orderId });
    const to = admin();
    if (!data?.order.print || !to) return;
    const { order, email, bookTitle } = data;
    const pr = order.print!;
    await send(to, `طلب طباعة: ${bookTitle ?? ""}`, [
      p(`طلب طباعة مدفوع (${sar(order.amount)}):`),
      list([
        ["الكتاب", bookTitle],
        ["عدد النسخ", String(pr.copies)],
        ["هدية", pr.gift ? `نعم، إلى ${pr.giftTo ?? ""}` : "لا"],
        ["رسالة الهدية", pr.giftMessage],
        ["الاسم", pr.name],
        ["الجوال", pr.phone],
        ["المدينة", pr.city],
        ["العنوان", pr.address],
        ["البريد", email],
      ]),
    ].join(""));
  },
});

/** To the customer, once Moyasar has confirmed the payment. */
export const receipt = internalAction({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const data = await ctx.runQuery(internal.orders.forEmail, { orderId });
    if (!data?.email) return;
    const { order, userName } = data;
    await send(data.email, "تم استلام الدفع — رف الحكايات", [
      p(userName ? `مرحبًا ${esc(userName)}،` : "مرحبًا،"),
      p("شكرًا لك! وصلنا الدفع:"),
      list([["الطلب", order.description], ["المبلغ", sar(order.amount)], ["رقم الطلب", order._id]]),
      p(order.kind === "print" ? "سنجهّز الكتاب المطبوع ونرسله إليك قريبًا." : "بدأ فريقنا العمل على قصتك، وتستطيع متابعة مراحلها من «كتبي» ← «قيد الإعداد»."),
    ].join(""));
  },
});
