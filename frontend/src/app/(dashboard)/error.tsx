"use client";

import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  error: Error;
  reset: () => void;
};

/**
 * DashboardError 组件/函数。
 */
export default function DashboardError({ error, reset }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[min(50vh,calc(100vh-10rem))] w-full flex-col items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200/90 bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.04] dark:border-slate-600 dark:bg-slate-900 dark:shadow-none dark:ring-slate-700/80">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{t("error.dashboardTitle")}</h2>
        <p className="danger mt-3 text-left text-sm">{error.message}</p>
        <button
          type="button"
          className="mt-6 !rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          onClick={() => reset()}
        >
          {t("error.retry")}
        </button>
      </section>
    </div>
  );
}

