import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { currentUser } from "./users";
import { CATEGORIES, isCategory } from "./categories";

/**
 * Books for the shelf: every public book plus the signed-in user's own, in shelf order. Guests
 * pass the tokens of the stories they sent from this browser, to see those books too.
 */
export const list = query({
  args: { guestTokens: v.optional(v.array(v.string())) },
  handler: async (ctx, { guestTokens }) => {
    const pub = await ctx.db.query("books").withIndex("by_visibility", (q) => q.eq("visibility", "public")).collect();
    const user = await currentUser(ctx);
    const mine = user
      ? await ctx.db.query("books").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect()
      : [];
    for (const t of (guestTokens ?? []).slice(0, 20)) {
      mine.push(...(await ctx.db.query("books").withIndex("by_guest", (q) => q.eq("guestToken", t)).collect()));
    }
    const seen = new Set<string>();
    return [...pub, ...mine]
      .filter((b) => !seen.has(b._id) && !!seen.add(b._id))
      .sort((a, b) => a.order - b.order)
      .map(({ guestToken: _secret, ...b }) => b);
  },
});

const DEMO = [
  { slug: "three-princesses", title_ar: "الأميرات الثلاث", status: "published", basePath: "/books/three-princesses", pdf: "The_Three_Princesses.pdf", cover: "/books/three-princesses/pages/p01.webp", category: "fairy" },
  { slug: "laila", title_ar: "ليلى والصقر الذهبي", status: "published", basePath: "/books/laila", pdf: "Laila_and_the_Golden_Falcon.pdf", cover: "/books/laila/pages/p01.webp", category: "travel" },
  { slug: "moon-garden", title_ar: "حديقة القمر", status: "coming_soon", cover: "/covers/moon-garden.webp", category: "space" },
  { slug: "little-sailor", title_ar: "البحّار الصغير", status: "coming_soon", cover: "/covers/little-sailor.webp", category: "sea" },
] as const;

/** Puts the demo books in the database (safe to run again). `npx convex run books:seed` */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const [i, b] of DEMO.entries()) {
      const row = { ...b, visibility: "public" as const, order: i + 1 };
      const existing = await ctx.db.query("books").withIndex("by_slug", (q) => q.eq("slug", b.slug)).unique();
      if (existing) await ctx.db.replace(existing._id, row);
      else await ctx.db.insert("books", row);
    }
  },
});

/** Admin: put a book (every row with this slug) in a toy category. `npx convex run books:setCategory '{"slug":"laila","category":"travel"}'` */
export const setCategory = internalMutation({
  args: { slug: v.string(), category: v.string() },
  handler: async (ctx, { slug, category }) => {
    if (!isCategory(category)) throw new Error(`Unknown category; use one of ${CATEGORIES.map((c) => c.id).join(", ")}`);
    const rows = await ctx.db.query("books").withIndex("by_slug", (q) => q.eq("slug", slug)).collect();
    for (const b of rows) await ctx.db.patch(b._id, { category });
    return rows.length;
  },
});
