"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoginLoadingFallback } from "@/components/auth/LoginLoadingFallback";
import { useI18n } from "@/i18n/I18nProvider";

function UnauthorizedInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/system-settings";
  return (
    <main className="jump-page dark:bg-slate-950">
      <h1 className="text-slate-900 dark:text-slate-100">{t("unauthorized.title")}</h1>
      <p className="text-slate-600 dark:text-slate-300">{t("unauthorized.body", { path: from })}</p>
      <div className="jump-links">
        <Link href="/">{t("unauthorized.backLogin")}</Link>
        <Link href="/new-task">{t("unauthorized.enterWorkbench")}</Link>
      </div>
    </main>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <UnauthorizedInner />
    </Suspense>
  );
}
