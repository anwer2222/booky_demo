// Shelf contents for the demo. Shaped like the future Convex `books` records, so the shelf
// reads the same fields later; `locked` is worked out from status, never stored.

export type BookStatus = "published" | "coming_soon";
export type Visibility = "public" | "family";

export type ShelfBook = {
  id: string;
  slot: number; // 1 = right-most position on the shelf (RTL)
  title_ar: string;
  status: BookStatus;
  visibility: Visibility;
  basePath?: string; // folder holding manifest.json, page images and the PDF
  cover: string; // card image for the "my books" list
};

export const books: ShelfBook[] = [
  {
    id: "three-princesses",
    slot: 1,
    title_ar: "الأميرات الثلاث",
    status: "published",
    visibility: "public",
    basePath: "/books/three-princesses",
    cover: "/books/three-princesses/pages/p01.webp",
  },
  { id: "moon-garden", slot: 2, title_ar: "حديقة القمر", status: "coming_soon", visibility: "public", cover: "/covers/moon-garden.webp" },
  { id: "desert-kite", slot: 3, title_ar: "طائرة الصحراء الورقية", status: "coming_soon", visibility: "public", cover: "/covers/desert-kite.webp" },
  { id: "little-sailor", slot: 4, title_ar: "البحّار الصغير", status: "coming_soon", visibility: "public", cover: "/covers/little-sailor.webp" },
  { id: "star-castle", slot: 5, title_ar: "قلعة النجوم", status: "coming_soon", visibility: "public", cover: "/covers/star-castle.webp" },
];

/**
 * Mock-up only: stories a family has sent in that an admin is still turning into a book.
 * Shaped like the future Convex `submissions` records.
 */
export type SubmissionStage = "received" | "writing" | "illustrating" | "ready";
export type Submission = {
  id: string;
  title_ar: string;
  child_ar: string;
  source: "text" | "docx" | "handwriting";
  stage: SubmissionStage;
  sent: string; // ISO date
  visibility: Visibility;
};

export const STAGES: { id: SubmissionStage; label_ar: string }[] = [
  { id: "received", label_ar: "وصلت القصة" },
  { id: "writing", label_ar: "تنسيق النص" },
  { id: "illustrating", label_ar: "الرسومات" },
  { id: "ready", label_ar: "الكتاب جاهز" },
];

export const submissions: Submission[] = [
  { id: "s1", title_ar: "القطة التي أحبّت المطر", child_ar: "ليان، ٧ سنوات", source: "handwriting", stage: "illustrating", sent: "2026-10-28", visibility: "family" },
  { id: "s2", title_ar: "رحلتي إلى القمر", child_ar: "يوسف، ٩ سنوات", source: "docx", stage: "writing", sent: "2026-11-06", visibility: "public" },
  { id: "s3", title_ar: "صديقي الجمل", child_ar: "ليان، ٧ سنوات", source: "text", stage: "received", sent: "2026-11-11", visibility: "family" },
];

export const isLocked = (b: ShelfBook) => b.status !== "published";

export type BookManifest = {
  id: string;
  title_ar: string;
  title_en: string;
  direction: "rtl" | "ltr";
  page_size_in: [number, number];
  pdf: string;
  pages: { index: number; kind: string; src: string }[];
};
