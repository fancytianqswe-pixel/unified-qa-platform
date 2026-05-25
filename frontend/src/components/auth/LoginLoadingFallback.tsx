"use client";

import { useI18n } from "@/i18n/I18nProvider";

export function LoginLoadingFallback() {
  const { t } = useI18n();
  return (
    <main className="jump-page px-4 dark:bg-slate-950">
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</p>
    </main>
  );
}
