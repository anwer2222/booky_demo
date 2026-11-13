import { internalMutation, query } from "./_generated/server";
import { currentUser } from "./users";

/** Books for the shelf: every public book plus the signed-in user's own, in shelf order. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const pub = await ctx.db.query("books").withIndex("by_visibility", (q) => q.eq("visibility", "public")).collect();
    const user = await currentUser(ctx);
    const mine = user
      ? await ctx.db.query("books").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect()
      : [];
    const seen = new Set(pub.map((b) => b._id));
    return [...pub, ...mine.filter((b) => !seen.has(b._id))].sort((a, b) => a.order - b.order);
  },
});

const DEMO = [
  { slug: "three-princesses", title_ar: "الأميرات الثلاث", status: "published", basePath: "/books/three-princesses", pdf: "The_Three_Princesses.pdf", cover: "/books/three-princesses/pages/p01.webp" },
  { slug: "laila", title_ar: "ليلى والصقر الذهبي", status: "published", basePath: "/books/laila", pdf: "Laila_and_the_Golden_Falcon.pdf", cover: "/books/laila/pages/p01.webp" },
  { slug: "moon-garden", title_ar: "حديقة القمر", status: "coming_soon", cover: "/covers/moon-garden.webp" },
  { slug: "little-sailor", title_ar: "البحّار الصغير", status: "coming_soon", cover: "/covers/little-sailor.webp" },
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
