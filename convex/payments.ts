// Moyasar payments through hosted invoices (https://docs.moyasar.com/api/invoices/01-create-invoice):
// the server creates an invoice for the amount it worked out, the customer pays on Moyasar's page,
// and the payment counts only after the server has read the invoice back from Moyasar as "paid".
//
// Convex environment variables:
//   MOYASAR_SECRET_KEY  sk_test_... while testing (Moyasar dashboard → Settings → API keys)
//   SITE_URL            where Moyasar sends the customer back, e.g. http://localhost:3000

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";

const API = "https://api.moyasar.com/v1";

type Invoice = { id: string; status: string; amount: number; currency: string; url: string };

async function moyasar(path: string, init?: RequestInit): Promise<Invoice> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) throw new ConvexError("PAYMENTS_OFF"); // MOYASAR_SECRET_KEY is not set
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`Moyasar ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** The caller's order: signed in, or a guest holding the order's token. */
async function ownOrder(ctx: ActionCtx, orderId: Id<"orders">, guestToken?: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity && !guestToken) throw new Error("Not signed in");
  const order = await ctx.runQuery(internal.orders.forCheckout, { orderId, tokenIdentifier: identity?.tokenIdentifier, guestToken });
  if (!order) throw new Error("Order not found");
  return order;
}

/** Re-reads the invoice from Moyasar and records the result. Returns the order's status. */
export async function settle(ctx: ActionCtx, order: Doc<"orders">) {
  if (order.status === "paid" || !order.invoiceId) return order.status;
  const inv = await moyasar(`/invoices/${order.invoiceId}`);
  if (inv.status === "paid" && inv.amount === order.amount && inv.currency === "SAR") {
    await ctx.runMutation(internal.orders.markPaid, { orderId: order._id });
    return "paid";
  }
  if (["failed", "canceled", "expired", "voided"].includes(inv.status)) {
    await ctx.runMutation(internal.orders.markFailed, { orderId: order._id });
    return "failed";
  }
  return "pending";
}

/** Returns the Moyasar page to pay this order on. */
export const checkout = action({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, { orderId, guestToken }): Promise<string> => {
    const order = await ownOrder(ctx, orderId, guestToken);
    if (order.status === "paid") throw new Error("Already paid");
    if (order.invoiceId && order.invoiceUrl && (await settle(ctx, order)) === "pending") return order.invoiceUrl;
    const site = process.env.SITE_URL ?? "http://localhost:3001";
    // a guest has no session to come back to, so their token rides along in the return link
    const back = `${site}/?order=${orderId}${order.guestToken ? `&g=${order.guestToken}` : ""}`;
    const inv = await moyasar("/invoices", {
      method: "POST",
      body: JSON.stringify({
        amount: order.amount,
        currency: "SAR",
        description: order.description,
        success_url: back,
        back_url: back,
        callback_url: `${process.env.CONVEX_SITE_URL}/moyasar/callback`,
        expired_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        metadata: { order_id: orderId },
      }),
    });
    await ctx.runMutation(internal.orders.setInvoice, { orderId, invoiceId: inv.id, invoiceUrl: inv.url });
    const url = new URL(inv.url);
    url.searchParams.set("lang", "ar"); // Moyasar's payment page in Arabic
    return url.toString();
  },
});

/** Called when Moyasar sends the customer back to the site. */
export const verify = action({
  args: { orderId: v.id("orders"), guestToken: v.optional(v.string()) },
  handler: async (ctx, { orderId, guestToken }): Promise<string> => settle(ctx, await ownOrder(ctx, orderId, guestToken)),
});
