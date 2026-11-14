"use client";

import dynamic from "next/dynamic";

// The 3D scene only runs in the browser.
const StoryShelf = dynamic(() => import("@/components/StoryShelf"), {
  ssr: false,
  loading: () => <div className="loading">جارٍ تجهيز الرف…</div>,
});

export default function Home() {
  return <StoryShelf />;
}
