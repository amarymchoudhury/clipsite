import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipForge: AI video clipping",
  description: "Turn long videos into short-form clips, ready for TikTok, Reels and Shorts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-white">{children}</body>
    </html>
  );
}
