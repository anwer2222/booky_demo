import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { currentUser, isEmail, newGuestToken, normEmail } from "./users";
import { MAX_COPIES, printCharge } from "./pricing";

const text = (s: string, max: number) => s.trim().slice(0, max);

/**
 * Order printed copies of a published book, for the reader or as a gift. Paid through Moyasar.
 * Guests order with an email (linked to their account if they sign up with it later).
 */
export const createPrint = mutation({
  args: {
    bookId: v.id("books"),
    email: v.optional(v.string()), // guests only
    copies: v.number(),
    gift: v.boolean(),
    giftTo: v.optional(v.string()),
    giftMessage: v.optional(v.string()),
    name: v.string(),
    phone: v.string(),
    city: v.string(),
    address: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await currentUser(ctx);
    const email = user?.email ? normEmail(user.email) : a.email ? normEmail(a.email) : undefined;
    if (!user && !(email && isEmail(email))) throw new Error("An email is required");
    const book = await ctx.db.get(a.bookId);
    if (!book || book.status !== "published") throw new Error("This book cannot be printed yet");
    if (book.visibility === "private" && (!user || book.ownerId !== user._id)) throw new Error("Not your book");
    const copies = Math.round(a.copies);
    if (copies < 1 || copies > MAX_COPIES) throw new Error(`1 to ${MAX_COPIES} copies`);
    const print = {
      copies, gift: a.gift,
      giftTo: a.gift && a.giftTo ? text(a.giftTo, 80) : undefined,
      giftMessage: a.gift && a.giftMessage ? text(a.giftMessage, 300) : undefined,
      name: text(a.name, 80), phone: text(a.phone, 20), city: text(a.city, 60), address: text(a.address, 300),
    };
    if (!print.name || !print.city || !print.address || !/^\+?[0-9 ]{9,15}$/.test(print.phone)) {
      throw new Error("Name, phone, city and address are required");
    }
    const guestToken = user ? undefined : newGuestToken();
    const orderId = await ctx.db.insert("orders", {
      userId: user?._id, email, guestToken, kind: "print", bookId: book._id, print, status: "pending",
      amount: printCharge(copies, a.gift) * 100,
      description: `${copies} × نسخة مطبوعة من «${book.title_ar}»${a.gift ? " (هدية)" : ""}`,
    });
    return { orderId, guestToken: guestToken ?? null };
  },
});

/** The signed-in user's order (for the "payment received" message after Moyasar sends them back). */
export const mine = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const user = await currentUser(ctx);
    const order = await ctx.db.get(orderId);
    if (!user || !order || order.userId !== user._id) return null;
    return { status: order.status, kind: order.kind, amount: order.amount, description: order.description };
  },
});

// ---- used by payments.ts ----

/** The order, if it belongs to this signed-in user or this guest token. */
export const forCheckout = internalQuery({
  args: { orderId: v.id("orders"), tokenIdentifier: v.optional(v.string()), guestToken: v.optional(v.string()) },
  handler: async (ctx, { orderId, tokenIdentifier, guestToken }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    if (guestToken && order.guestToken === guestToken) return order;
    const user = order.userId ? await ctx.db.get(order.userId) : null;
    return tokenIdentifier && user?.tokenIdentifier === tokenIdentifier ? order : null;
  },
});

export const byInvoice = internalQuery({
  args: { invoiceId: v.string() },
  handler: (ctx, { invoiceId }) => ctx.db.query("orders").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).unique(),
});

export const setInvoice = internalMutation({
  args: { orderId: v.id("orders"), invoiceId: v.string(), invoiceUrl: v.string() },
  handler: (ctx, { orderId, ...invoice }) => ctx.db.patch(orderId, invoice),
});

/** Moyasar confirmed the payment. Safe to call more than once (redirect and callback both do). */
export const markPaid = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.status === "paid") return;
    await ctx.db.patch(orderId, { status: "paid" });
    if (order.kind === "story" && order.submissionId) {
      await ctx.db.patch(order.submissionId, { payment: "paid" });
      await ctx.scheduler.runAfter(0, internal.emails.newStory, { submissionId: order.submissionId });
    }
    if (order.kind === "print") await ctx.scheduler.runAfter(0, internal.emails.printOrder, { orderId });
    await ctx.scheduler.runAfter(0, internal.emails.receipt, { orderId });
  },
});

export const markFailed = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (order && order.status === "pending") await ctx.db.patch(orderId, { status: "failed" });
  },
});

// ---- used by emails.ts ----

export const forEmail = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const user = order.userId ? await ctx.db.get(order.userId) : null;
    const book = order.bookId ? await ctx.db.get(order.bookId) : null;
    return { order, email: user?.email ?? order.email, userName: user?.name, bookTitle: book?.title_ar };
  },
});
