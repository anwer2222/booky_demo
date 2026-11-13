// Shelf data types. The books themselves live in Convex (convex/books.ts); `locked` is worked out
// from status, never stored.

import type { Doc } from "../../convex/_generated/dataModel";

export type ShelfBook = Doc<"books">;
export type Submission = Doc<"submissions">;

export const isLocked = (b: ShelfBook) => b.status !== "published" || !b.basePath;

export const SHELF_SLOTS = 4; // books visible on the shelf at a time

export const STAGES: { id: Submission["stage"]; label_ar: string }[] = [
  { id: "received", label_ar: "وصلت القصة" },
  { id: "writing", label_ar: "تنسيق النص" },
  { id: "illustrating", label_ar: "الرسومات" },
  { id: "ready", label_ar: "الكتاب جاهز" },
];

export type BookManifest = {
  id: string;
  title_ar: string;
  title_en: string;
  direction: "rtl" | "ltr";
  page_size_in: [number, number];
  pdf: string;
  cover_color?: string;
  pages: { index: number; kind: string; src: string }[];
};
