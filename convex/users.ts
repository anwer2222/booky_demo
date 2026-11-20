import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";

/** The signed-in user's row, or null when signed out or not stored yet. */
export async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export const normEmail = (s: string) => s.trim().toLowerCase();
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120;
/** A guest's secret for one story or order: kept in their browser, and in the payment return link. */
export const newGuestToken = () => crypto.randomUUID();

/** Stories, books and orders sent as a guest with this email now belong to the account. */
async function claimGuestRows(ctx: MutationCtx, userId: Id<"users">, email: string) {
  const subs = await ctx.db.query("submissions").withIndex("by_email", (q) => q.eq("email", email)).collect();
  for (const s of subs) {
    if (s.userId) continue;
    await ctx.db.patch(s._id, { userId });
    if (s.bookId) await ctx.db.patch(s.bookId, { ownerId: userId });
  }
  const orders = await ctx.db.query("orders").withIndex("by_email", (q) => q.eq("email", email)).collect();
  for (const o of orders) if (!o.userId) await ctx.db.patch(o._id, { userId });
}

/**
 * Called by the app after sign-in. Creates the user on first sign-in and sends the welcome email,
 * and links anything sent as a guest with the same (Clerk-verified) email to the account.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const email = identity.email ? normEmail(identity.email) : undefined;
    const existing = await currentUser(ctx);
    if (existing) {
      if (email) await claimGuestRows(ctx, existing._id, email);
      return existing._id;
    }
    const id = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email,
      name: identity.name ?? identity.givenName,
    });
    if (email) await claimGuestRows(ctx, id, email);
    if (identity.email) {
      await ctx.scheduler.runAfter(0, internal.emails.welcome, { to: identity.email, name: identity.name ?? "" });
    }
    return id;
  },
});
