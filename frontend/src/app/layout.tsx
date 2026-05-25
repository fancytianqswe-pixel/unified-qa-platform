import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "./globals.css";
/** 必须在 globals 之后，保证滚动条规则处于全站样式表链末端（见文件头注释） */
import "./scrollbar-overrides.css";

export const metadata: Metadata = {
  title: "统一质检平台",
  description: "统一质检平台 AI 应用管理平台",
  icons: {
    icon: "/brand/logo.png",
    shortcut: "/brand/logo.png",
    apple: "/brand/logo.png",
  },
};

/**
 * RootLayout 组件/函数。
 * 不再使用 `next/font/google`（Geist）：在无法访问 Google Fonts 的网络/构建环境中会导致模块拉取失败，进而整站无法渲染。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-screen bg-[#F7F8FA] text-gray-800 dark:bg-slate-950 dark:text-slate-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
