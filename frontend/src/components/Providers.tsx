"use client";

import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ClientRuntimeDiagnostics } from "@/components/ClientRuntimeDiagnostics";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <I18nProvider>
        {children}
        <ClientRuntimeDiagnostics />
      </I18nProvider>
    </AppErrorBoundary>
  );
}
