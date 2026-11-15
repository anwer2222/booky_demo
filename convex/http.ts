import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { settle } from "./payments";

const http = httpRouter();

// Moyasar POSTs the invoice here when it is paid, even if the customer never comes back to the
// site. The body is not trusted: the invoice is read again from Moyasar before anything changes.
http.route({
  path: "/moyasar/callback",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) return new Response("missing id", { status: 400 });
    const order = await ctx.runQuery(internal.orders.byInvoice, { invoiceId: body.id });
    if (!order) return new Response("unknown invoice", { status: 404 });
    await settle(ctx, order);
    return new Response("ok");
  }),
});

export default http;
