// Prices in SAR. Shared by the server (which charges) and the app (which shows them), so the two
// never disagree. Amounts sent to Moyasar are in halalas (1 SAR = 100).

/** Book lengths a family can choose: story pages, not counting covers, title and endpapers. */
export const PAGE_OPTIONS = [20, 24, 30, 34, 40] as const;

/** 20 pages: 25 SAR. 30 pages: 40 SAR (1.5 SAR a page in between). Every page after 30: 2 SAR. */
export function storyPrice(pages: number) {
  if (pages <= 20) return 25;
  if (pages <= 30) return 25 + (pages - 20) * 1.5;
  return 40 + (pages - 30) * 2;
}

/** The first story is free up to 20 pages; a longer first book pays only the extra pages. */
export function storyCharge(pages: number, firstStory: boolean) {
  const full = storyPrice(pages);
  return firstStory ? full - storyPrice(20) : full;
}

// Printed copies. PLACEHOLDER prices: set these before going live.
export const PRINT_COPY = 79; // hardcover copy
export const PRINT_SHIPPING = 25; // one delivery anywhere in Saudi Arabia
export const GIFT_WRAP = 10;
export const MAX_COPIES = 5;

export function printCharge(copies: number, gift: boolean) {
  return copies * PRINT_COPY + PRINT_SHIPPING + (gift ? GIFT_WRAP : 0);
}

// Story uploads
export const MAX_FILES = 10;
export const MAX_FILE_MB = 10;
export const MAX_TOTAL_MB = 20; // Gmail takes up to 25 MB of attachments per email
export const STORY_TYPES = [
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
];
