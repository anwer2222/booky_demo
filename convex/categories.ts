// Story categories. Each one belongs to a toy on the toy shelf: tapping the toy shows only the
// books in its category. Shared by the server (which stores the id) and the app (labels, toys).

export const CATEGORIES = [
  { id: "space", toy: "Toy_Rocket", label_ar: "الفضاء والخيال" },
  { id: "travel", toy: "Toy_Train", label_ar: "رحلات ومغامرات" },
  { id: "world", toy: "Toy_Globe", label_ar: "عالمنا والطبيعة" },
  { id: "sea", toy: "Toy_Sailboat", label_ar: "حكايات البحر" },
  { id: "fairy", toy: "Toy_Sailboat_2", label_ar: "أميرات وحكايات خيالية" },
  { id: "family", toy: "Toy_House", label_ar: "العائلة والبيت" },
  { id: "friends", toy: "Toy_House_2", label_ar: "الصداقة والقيم" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const isCategory = (id: string): id is CategoryId => CATEGORIES.some((c) => c.id === id);
export const categoryOfToy = (toy: string) => CATEGORIES.find((c) => c.toy === toy) ?? null;
export const categoryLabel = (id: string | undefined) => CATEGORIES.find((c) => c.id === id)?.label_ar;

/** Shown until the family gives the story a title. */
export const UNTITLED_AR = "قصتي الجديدة";
/** Cover of every book that is still being made. */
export const PROCESSING_COVER = "/covers/processing.webp";
