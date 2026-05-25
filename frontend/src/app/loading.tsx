import { RouteLoading } from "@/components/layout/RouteLoading";

/**
 * 根级路由过渡（无侧栏全屏场景）：文案走 i18n，卡片显式浅色/深色底。
 */
export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col bg-[#F7F8FA] dark:bg-slate-950">
      <RouteLoading variant="page" />
    </main>
  );
}

