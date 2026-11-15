import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { currentUser } from "./users";
import { MAX_FILE_MB, MAX_FILES, MAX_TOTAL_MB, PAGE_OPTIONS, STORY_TYPES, storyCharge } from "./pricing";

/** The signed-in user's stories that are being made into books, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("submissions").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").collect();
    return rows.map(({ files, hero, ...s }) => ({ ...s, fileCount: files?.length ?? 0, hasHero: !!hero }));
  },
});

/** Whether the user's next story is their free one (nothing sent yet, or nothing completed). */
export const firstIsFree = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? isFirstStory(ctx, user._id) : true;
  },
});

async function isFirstStory(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("submissions").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  return !rows.some((s) => s.payment !== "pending"); // an unpaid story does not use up the free one
}

/** Step 1 of sending a story: one upload URL per file (the browser POSTs the file to it). */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (!(await currentUser(ctx))) throw new Error("Not signed in");
    return ctx.storage.generateUploadUrl();
  },
});

const file = v.object({ id: v.id("_storage"), name: v.string() });

/**
 * Step 2: save the story. The price comes from the page count (convex/pricing.ts). A free story
 * goes straight to the admin; a paid one waits for payment (payments.checkout).
 */
export const create = mutation({
  args: {
    title_ar: v.string(),
    child_ar: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    pages: v.number(),
    files: v.array(file),
    hero: v.optional(file),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) throw new Error("Not signed in");
    const title_ar = args.title_ar.trim().slice(0, 120);
    const child_ar = args.child_ar.trim().slice(0, 80);
    if (!title_ar || !child_ar) throw new Error("Title and author are required");
    if (!(PAGE_OPTIONS as readonly number[]).includes(args.pages)) throw new Error("Unknown book length");
    if (args.files.length === 0 || args.files.length > MAX_FILES) throw new Error(`Send 1 to ${MAX_FILES} story files`);

    // Check the stored files themselves: their real size, and the type they were uploaded with.
    let total = 0;
    const check = async (f: { id: Id<"_storage"> }, imageOnly: boolean) => {
      const meta = await ctx.db.system.get(f.id);
      if (!meta) throw new Error("A file is missing; upload it again");
      const type = meta.contentType ?? "";
      if (imageOnly ? !type.startsWith("image/") : !STORY_TYPES.includes(type)) throw new Error(`File type not allowed: ${type}`);
      if (meta.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Each file must be under ${MAX_FILE_MB} MB`);
      total += meta.size;
    };
    for (const f of args.files) await check(f, false);
    if (args.hero) await check(args.hero, true);
    if (total > MAX_TOTAL_MB * 1024 * 1024) throw new Error(`All files together must be under ${MAX_TOTAL_MB} MB`);

    const sar = storyCharge(args.pages, await isFirstStory(ctx, user._id));
    const files = args.files.map((f) => ({ id: f.id, name: f.name.slice(0, 120) }));
    const hero = args.hero && { id: args.hero.id, name: args.hero.name.slice(0, 120) };
    const id = await ctx.db.insert("submissions", {
      userId: user._id, title_ar, child_ar, visibility: args.visibility, stage: "received",
      pages: args.pages, files, hero, payment: sar > 0 ? "pending" : "free",
    });
    if (sar === 0) {
      await ctx.scheduler.runAfter(0, internal.emails.newStory, { submissionId: id });
      return { submissionId: id, orderId: null };
    }
    const orderId = await ctx.db.insert("orders", {
      userId: user._id, kind: "story", amount: Math.round(sar * 100), status: "pending", submissionId: id,
      description: `كتاب «${title_ar}» (${args.pages} صفحة)`,
    });
    await ctx.db.patch(id, { orderId });
    return { submissionId: id, orderId };
  },
});

/** Everything the "new story" email needs. */
export const forEmail = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const s = await ctx.db.get(submissionId);
    if (!s) return null;
    const user = await ctx.db.get(s.userId);
    const order = s.orderId ? await ctx.db.get(s.orderId) : null;
    return { s, email: user?.email, amount: order?.amount ?? 0 };
  },
});
