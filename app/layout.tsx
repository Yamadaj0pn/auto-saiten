import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "自動採点",
  description: "手書き答案を Gemini で自動採点する Web アプリ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 text-slate-900 min-h-screen">{children}</body>
    </html>
  );
}
