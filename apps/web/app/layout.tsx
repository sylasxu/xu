import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "聚场 - 你的 AI 活动助理",
  description: "聚场帮你轻松组局，AI 智能推荐活动，一键报名参与。",
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
