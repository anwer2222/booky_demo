// Reading state for the demo. The 3D scene and the DOM buttons both read this one state.
//
// Book model (RTL): the front cover plus `leaves` leaves turn from the left stack to the right.
// `turned` counts how many of those have turned: 0 = closed, 1 = cover open, leaves + 1 = every leaf turned.
// Open spread for turned = t (t >= 1): right page = PDF page 2t, left page = PDF page 2t + 1.
// A book of N pages has (N - 4) / 2 leaves: the covers and the two endpapers glued inside them don't turn.

export const MAX_LEAVES = 13; // the 3D book is built with this many; shorter books use fewer
export const leavesFor = (pageCount: number) => Math.min(MAX_LEAVES, Math.max(1, (pageCount - 4) / 2));

export type Side = "right" | "left";
export type Mode = "shelf" | "toTable" | "table" | "toShelf";

export type ReaderState = {
  mode: Mode;
  turned: number;
  leaves: number;
  focus: Side | null;
  busy: boolean; // a page or the cover is turning; next/previous taps are ignored until it settles
};

export type ReaderAction =
  | { type: "OPEN_BOOK"; leaves: number }
  | { type: "ARRIVED" }
  | { type: "CLOSE_BOOK" }
  | { type: "RETURNED" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "FOCUS"; side: Side }
  | { type: "UNFOCUS" }
  | { type: "SETTLED" };

export const initialReader: ReaderState = { mode: "shelf", turned: 0, leaves: MAX_LEAVES, focus: null, busy: false };

const turnTo = (s: ReaderState, turned: number, focus: Side | null): ReaderState => ({
  ...s,
  turned,
  focus: turned === 0 ? null : focus,
  busy: true,
});

export function readerReducer(s: ReaderState, a: ReaderAction): ReaderState {
  switch (a.type) {
    case "OPEN_BOOK":
      return s.mode === "shelf" ? { ...initialReader, mode: "toTable", leaves: a.leaves } : s;
    case "ARRIVED":
      return s.mode === "toTable" ? { ...s, mode: "table" } : s;
    case "CLOSE_BOOK":
      return s.mode === "table" ? { ...s, mode: "toShelf", turned: 0, focus: null, busy: true } : s;
    case "RETURNED":
      return s.mode === "toShelf" ? { ...initialReader, leaves: s.leaves } : s;
    case "SETTLED":
      return s.busy ? { ...s, busy: false } : s;
    case "FOCUS":
      return s.mode === "table" && s.turned > 0 && !s.busy ? { ...s, focus: a.side } : s;
    case "UNFOCUS":
      return { ...s, focus: null };
    case "NEXT":
      if (s.mode !== "table" || s.busy) return s;
      // In page focus: read the right page, then the left page, then turn.
      if (s.focus === "right") return { ...s, focus: "left" };
      if (s.turned >= s.leaves + 1) return s;
      return turnTo(s, s.turned + 1, s.focus === "left" ? "right" : null);
    case "PREV":
      if (s.mode !== "table" || s.busy) return s;
      if (s.focus === "left") return { ...s, focus: "right" };
      if (s.turned <= 0) return s;
      return turnTo(s, s.turned - 1, s.focus === "right" ? "left" : null);
  }
}

export const canNext = (s: ReaderState) =>
  s.mode === "table" && !s.busy && (s.focus === "right" || s.turned < s.leaves + 1);
export const canPrev = (s: ReaderState) =>
  s.mode === "table" && !s.busy && (s.focus === "left" || s.turned > 0);

/** PDF page numbers visible for a spread, or null when the book is closed. */
export function visiblePages(turned: number): { right: number; left: number } | null {
  return turned === 0 ? null : { right: 2 * turned, left: 2 * turned + 1 };
}
