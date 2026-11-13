import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
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

/** Called by the app after sign-in. Creates the user on first sign-in and sends the welcome email. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const existing = await currentUser(ctx);
    if (existing) return existing._id;
    const id = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email: identity.email,
      name: identity.name ?? identity.givenName,
    });
    if (identity.email) {
      await ctx.scheduler.runAfter(0, internal.emails.welcome, { to: identity.email, name: identity.name ?? "" });
    }
    return id;
  },
});
