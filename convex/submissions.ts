import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { currentUser } from "./users";

/** The signed-in user's stories that are being made into books, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    return ctx.db.query("submissions").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").collect();
  },
});

/** A family sends a new story (title and author only for now; no files). The admin gets an email. */
export const create = mutation({
  args: {
    title_ar: v.string(),
    child_ar: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) throw new Error("Not signed in");
    const title_ar = args.title_ar.trim().slice(0, 120);
    const child_ar = args.child_ar.trim().slice(0, 80);
    if (!title_ar || !child_ar) throw new Error("Title and author are required");
    const id = await ctx.db.insert("submissions", { userId: user._id, title_ar, child_ar, visibility: args.visibility, stage: "received" });
    await ctx.scheduler.runAfter(0, internal.emails.newStory, {
      title: title_ar, child: child_ar, visibility: args.visibility, from: user.email ?? "",
    });
    return id;
  },
});
