"use node";
// Emails go out through Gmail SMTP with an app password (Google account → Security → App passwords).
// Convex environment variables:
//   GMAIL_USER          the sending address, e.g. dreptecc@gmail.com
//   GMAIL_APP_PASSWORD  16-character app password for that account
//   ADMIN_EMAIL         where "new story" notices go (defaults to GMAIL_USER)
// Without GMAIL_APP_PASSWORD the email is logged and skipped, so the app still works.

import nodemailer from "nodemailer";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (body: string) => `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#fbf5e9;font-family:Tahoma,Arial,sans-serif;color:#3b2a1e">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;border:2px solid #c9962c;line-height:1.8">
<h1 style="margin:0 0 12px;color:#1f6f76;font-size:24px">رَفُّ الحِكايات</h1>${body}</div></body></html>`;

async function send(to: string, subject: string, html: string) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log(`email skipped (GMAIL_USER / GMAIL_APP_PASSWORD not set): "${subject}" to ${to}`);
    return;
  }
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transport.sendMail({ from: `"رف الحكايات" <${user}>`, to, subject, html });
}

export const welcome = internalAction({
  args: { to: v.string(), name: v.string() },
  handler: async (_ctx, { to, name }) => {
    await send(to, "أهلًا بك في رف الحكايات!", page(`
<p>${name ? `مرحبًا ${esc(name)}،` : "مرحبًا،"}</p>
<p>سعداء بانضمامك إلى رف الحكايات! اقرأ القصص على الرف، وحين يكتب طفلك قصته، أرسلها إلينا وسنحوّلها إلى كتاب مصوّر جميل.</p>
<p>الكتاب الأول مجاني.</p>`));
  },
});

export const newStory = internalAction({
  args: { title: v.string(), child: v.string(), visibility: v.string(), from: v.string() },
  handler: async (_ctx, a) => {
    const admin = process.env.ADMIN_EMAIL ?? process.env.GMAIL_USER;
    if (!admin) return console.log("email skipped: no ADMIN_EMAIL");
    await send(admin, `قصة جديدة: ${a.title}`, page(`
<p>وصلت قصة جديدة:</p>
<ul><li>العنوان: ${esc(a.title)}</li><li>الكاتب: ${esc(a.child)}</li>
<li>الظهور: ${a.visibility === "public" ? "للجميع" : "للعائلة فقط"}</li><li>من: ${esc(a.from)}</li></ul>`));
  },
});
