import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "xu，碎片化社交助理",
  description: "xu 帮你接住碎片化社交需求，找人、凑局、开口、跟进结果。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
