import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per Clerk account, created on first sign-in (see users.store).
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"]),

  // Books on the shelf. "public" books are shown to everyone; "private" ones only to their owner
  // (a signed-in user, or a guest holding the book's `guestToken`). (Family sharing comes later.)
  // A story sent in gets a "processing" book at once, with the template cover and a ribbon. A book is readable when it is published and has a `basePath`
  // holding manifest.json, the page images and the PDF.
  books: defineTable({
    slug: v.string(),
    title_ar: v.string(),
    status: v.union(v.literal("published"), v.literal("coming_soon"), v.literal("processing")),
    visibility: v.union(v.literal("public"), v.literal("private")),
    ownerId: v.optional(v.id("users")),
    guestToken: v.optional(v.string()),
    submissionId: v.optional(v.id("submissions")),
    category: v.optional(v.string()), // convex/categories.ts
    basePath: v.optional(v.string()),
    pdf: v.optional(v.string()), // file name inside basePath
    cover: v.string(),
    order: v.number(), // shelf position, 1 = right-most (RTL)
  })
    .index("by_slug", ["slug"])
    .index("by_visibility", ["visibility", "order"])
    .index("by_owner", ["ownerId", "order"])
    .index("by_guest", ["guestToken"]),

  // Stories a family has sent in that an admin is turning into a book. The story itself is in
  // the uploaded files (text, Word or photos of handwritten pages), plus an optional hero picture.
  // Guests (no account) send with an email; signing up later with that email claims the story.
  submissions: defineTable({
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()), // lower case
    guestToken: v.optional(v.string()), // the guest's secret for this story and its order
    category: v.optional(v.string()),
    bookId: v.optional(v.id("books")),
    title_ar: v.string(),
    child_ar: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    stage: v.union(v.literal("received"), v.literal("writing"), v.literal("illustrating"), v.literal("ready")),
    pages: v.optional(v.number()),
    files: v.optional(v.array(v.object({ id: v.id("_storage"), name: v.string() }))),
    hero: v.optional(v.object({ id: v.id("_storage"), name: v.string() })),
    payment: v.optional(v.union(v.literal("free"), v.literal("pending"), v.literal("paid"))),
    orderId: v.optional(v.id("orders")),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"])
    .index("by_stage", ["stage"]),

  // Anything paid through Moyasar: making a story into a book, or printed copies of a book.
  // `amount` is in halalas and is always worked out on the server (convex/pricing.ts).
  orders: defineTable({
    userId: v.optional(v.id("users")), // empty for a guest order until they sign up
    email: v.optional(v.string()),
    guestToken: v.optional(v.string()),
    kind: v.union(v.literal("story"), v.literal("print")),
    amount: v.number(),
    description: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("failed")),
    invoiceId: v.optional(v.string()),
    invoiceUrl: v.optional(v.string()),
    submissionId: v.optional(v.id("submissions")),
    bookId: v.optional(v.id("books")),
    print: v.optional(v.object({
      copies: v.number(),
      gift: v.boolean(),
      giftTo: v.optional(v.string()),
      giftMessage: v.optional(v.string()),
      name: v.string(),
      phone: v.string(),
      city: v.string(),
      address: v.string(),
    })),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"])
    .index("by_invoice", ["invoiceId"]),
});
