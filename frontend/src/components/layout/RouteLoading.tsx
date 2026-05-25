"use client";

import { useI18n } from "@/i18n/I18nProvider";

type Variant = "page" | "dashboard";

/**
 * Next `loading.tsx` 用：须在 `I18nProvider` 内；避免嵌套 `<main>`（仪表盘内容已在 `DashboardShell` 的 `main` 内）。
 */
export function RouteLoading({ variant }: { variant: Variant }) {
  const { t } = useI18n();
  const title = variant === "dashboard" ? t("loading.dashboardTitle") : t("loading.pageTitle");
  const hint = variant === "dashboard" ? t("loading.dashboardHint") : t("loading.pageHint");

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[min(50vh,calc(100vh-10rem))] w-full flex-col items-center justify-center px-4 py-10"
    >
      <section className="w-full max-w-lg rounded-3xl border border-slate-200/90 bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.04] dark:border-slate-600 dark:bg-slate-900 dark:shadow-none dark:ring-slate-700/80">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{hint}</p>
      </section>
    </div>
  );
}
