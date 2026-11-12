import type { Metadata, Viewport } from "next";
import { Baloo_Bhaijaan_2 } from "next/font/google";
import "./globals.css";

// next/font downloads the font at build time and serves it from this site (no request to Google at runtime).
const baloo = Baloo_Bhaijaan_2({ subsets: ["arabic", "latin"], weight: ["500", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: "رف الحكايات",
  description: "قصص كتبها الأطفال، على رفّ ثلاثي الأبعاد",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d9c6a5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={baloo.className}>{children}</body>
    </html>
  );
}
