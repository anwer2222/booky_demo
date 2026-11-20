import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { currentUser, isEmail, newGuestToken, normEmail } from "./users";
import { MAX_FILE_MB, MAX_FILES, MAX_TOTAL_MB, PAGE_OPTIONS, STORY_TYPES, storyCharge } from "./pricing";
import { isCategory, PROCESSING_COVER, UNTITLED_AR } from "./categories";

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

/**
 * Whether the next story is the free one: only the very first story a family sends, counted both
 * by account and by email, so sending as a guest and then signing up does not give a second one.
 * Guests pass the email they typed.
 */
export const firstIsFree = query({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const user = await currentUser(ctx);
    const mail = user?.email ?? email;
    if (!user && !(mail && isEmail(normEmail(mail)))) return true;
    return isFirstStory(ctx, user?._id, mail);
  },
});

async function isFirstStory(ctx: QueryCtx, userId: Id<"users"> | undefined, email: string | undefined) {
  const rows = [
    ...(userId ? await ctx.db.query("submissions").withIndex("by_user", (q) => q.eq("userId", userId)).collect() : []),
    ...(email ? await ctx.db.query("submissions").withIndex("by_email", (q) => q.eq("email", normEmail(email))).collect() : []),
  ];
  return !rows.some((s) => s.payment !== "pending"); // an unpaid story does not use up the free one
}

/** At most this many families can have stories being made at once; others wait until a slot frees up. */
export const MAX_FAMILIES_IN_PROCESS = 50;

/** Families (account or email) with a story not yet ready. */
async function familiesInProcess(ctx: QueryCtx) {
  const who = new Set<string>();
  for (const stage of ["received", "writing", "illustrating"] as const) {
    const rows = await ctx.db.query("submissions").withIndex("by_stage", (q) => q.eq("stage", stage)).collect();
    for (const s of rows) who.add(s.userId ?? s.email ?? s._id);
  }
  return who;
}

/** Whether a new family can send a story now. A family that already has one in process always can. */
async function hasRoom(ctx: QueryCtx, userId: Id<"users"> | undefined, email: string | undefined) {
  const who = await familiesInProcess(ctx);
  if ((userId && who.has(userId)) || (email && who.has(normEmail(email)))) return true;
  return who.size < MAX_FAMILIES_IN_PROCESS;
}

/** For the form: false when the queue is full for this family. */
export const canSend = query({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const user = await currentUser(ctx);
    return hasRoom(ctx, user?._id, user?.email ?? email);
  },
});

/** Step 1 of sending a story: one upload URL per file (the browser POSTs the file to it). Guests too. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

const file = v.object({ id: v.id("_storage"), name: v.string() });

/**
 * Step 2: save the story, signed in or as a guest (with an email). The price comes from the page
 * count (convex/pricing.ts). A free story goes straight to the admin; a paid one waits for payment
 * (payments.checkout). Either way a "processing" book with the template cover goes on the shelf.
 */
export const create = mutation({
  args: {
    title_ar: v.string(), // may be empty: the book is called UNTITLED_AR until it has a title
    email: v.optional(v.string()), // guests only
    category: v.optional(v.string()),
    child_ar: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    pages: v.number(),
    files: v.array(file),
    hero: v.optional(file),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const email = user?.email ? normEmail(user.email) : args.email ? normEmail(args.email) : undefined;
    if (!user && !(email && isEmail(email))) throw new Error("An email is required");
    const guestToken = user ? undefined : newGuestToken();
    const title_ar = args.title_ar.trim().slice(0, 120) || UNTITLED_AR;
    const child_ar = args.child_ar.trim().slice(0, 80);
    if (!child_ar) throw new Error("The author is required");
    const category = args.category && isCategory(args.category) ? args.category : undefined;
    if (!(await hasRoom(ctx, user?._id, email))) throw new ConvexError("QUEUE_FULL");
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

    const sar = storyCharge(args.pages, await isFirstStory(ctx, user?._id, email));
    const files = args.files.map((f) => ({ id: f.id, name: f.name.slice(0, 120) }));
    const hero = args.hero && { id: args.hero.id, name: args.hero.name.slice(0, 120) };
    const id = await ctx.db.insert("submissions", {
      userId: user?._id, email, guestToken, category, title_ar, child_ar, visibility: args.visibility, stage: "received",
      pages: args.pages, files, hero, payment: sar > 0 ? "pending" : "free",
    });
    // The book is private while it is being made, whatever the family chose; it goes public when published.
    const bookId = await ctx.db.insert("books", {
      slug: `story-${id}`, title_ar, status: "processing", visibility: "private", cover: PROCESSING_COVER,
      ownerId: user?._id, guestToken, submissionId: id, category, order: Date.now(),
    });
    await ctx.db.patch(id, { bookId });
    if (sar === 0) {
      await ctx.scheduler.runAfter(0, internal.emails.newStory, { submissionId: id });
      await ctx.scheduler.runAfter(0, internal.emails.storyReceived, { submissionId: id });
      return { submissionId: id, orderId: null, guestToken: guestToken ?? null };
    }
    const orderId = await ctx.db.insert("orders", {
      userId: user?._id, email, guestToken, kind: "story", amount: Math.round(sar * 100), status: "pending", submissionId: id,
      description: `كتاب «${title_ar}» (${args.pages} صفحة)`,
    });
    await ctx.db.patch(id, { orderId });
    return { submissionId: id, orderId, guestToken: guestToken ?? null };
  },
});

/** Everything the "new story" email needs. */
export const forEmail = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const s = await ctx.db.get(submissionId);
    if (!s) return null;
    const user = s.userId ? await ctx.db.get(s.userId) : null;
    const order = s.orderId ? await ctx.db.get(s.orderId) : null;
    return { s, email: user?.email ?? s.email, guest: !user, amount: order?.amount ?? 0 };
  },
});
