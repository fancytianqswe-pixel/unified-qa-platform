"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { intlLocaleForApp, type AppLocale } from "@/lib/ui-preferences";
import type { TaskCenterListRow } from "@/lib/task-center-map";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  StatusBadge,
} from "@/components/ui/table";

function formatInstant(iso: string | null, locale: AppLocale): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(intlLocaleForApp(locale), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * 任务中心：任务列表（数据来自 Hermes Gateway /api/jobs，经 BFF /api/tasks/list）。
 */
export function TaskCenterListPage() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<TaskCenterListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setHint(null);
    try {
      const res = await fetch("/api/tasks/list", { cache: "no-store" });
      let data: { ok?: boolean; tasks?: TaskCenterListRow[]; message?: string };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setRows([]);
        setHint(t("taskCenter.loadError"));
        return;
      }
      setRows(Array.isArray(data.tasks) ? data.tasks : []);
      if (!res.ok || data.ok === false) {
        const raw = data.message;
        const msg =
          typeof raw === "string"
            ? raw
            : raw != null && typeof raw === "object"
              ? JSON.stringify(raw)
              : raw != null
                ? String(raw)
                : "";
        setHint(msg.trim() ? msg : t("taskCenter.loadError"));
      }
    } catch {
      setRows([]);
      setHint(t("taskCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const execBadge = (s: TaskCenterListRow["lastRunStatus"]) => {
    if (s === "success") return t("taskCenter.execSuccess");
    if (s === "failure") return t("taskCenter.execFailure");
    if (s === "running") return t("taskCenter.execRunning");
    return t("taskCenter.execNone");
  };

  return (
    <main className="skill-shell flex flex-col gap-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t("taskCenter.title")}</h1>
      </header>

      {hint ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {t("taskCenter.remoteHint", { message: hint })}
        </p>
      ) : null}

      <section className="task-card overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">{t("taskCenter.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t("taskCenter.colTaskId")}</TableHeaderCell>
                  <TableHeaderCell>{t("taskCenter.colTaskName")}</TableHeaderCell>
                  <TableHeaderCell>{t("taskCenter.colSkill")}</TableHeaderCell>
                  <TableHeaderCell>{t("taskCenter.colSchedule")}</TableHeaderCell>
                  <TableHeaderCell>{t("taskCenter.colSwitch")}</TableHeaderCell>
                  <TableHeaderCell>{t("taskCenter.colLastRun")}</TableHeaderCell>
                  <TableHeaderCell>{t("taskCenter.colLastStatus")}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.taskId}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{row.taskId}</TableCell>
                    <TableCell className="max-w-[14rem] truncate">
                      <span title={row.taskName}>{row.taskName}</span>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate">
                      <span title={row.associatedSkill}>{row.associatedSkill}</span>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-xs">
                      <span title={row.scheduleFrequency}>{row.scheduleFrequency}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.switchEnabled ? t("taskCenter.badgeEnabled") : t("taskCenter.badgeDisabled")} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                      {formatInstant(row.lastRunAtIso, locale)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={execBadge(row.lastRunStatus)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </main>
  );
}
