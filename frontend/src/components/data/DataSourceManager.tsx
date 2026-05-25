"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListFilter } from "lucide-react";
import {
  DbKind,
  DataSourceForm,
  DataSourceRecord,
  DataSourceStoredConfig,
  DataSourceType,
} from "@/components/data/types";
import { connectionSummary, loadDataSourcesFromStorage, normalizeStoredRecord, saveDataSourcesToStorage } from "@/lib/datasource-storage";
import { formatDatasourcePreviewCell } from "@/lib/datasource-preview-cell";
import {
  ActionIconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/i18n/I18nProvider";
import { formatMessage } from "@/i18n/registry";
import { intlLocaleForApp } from "@/lib/ui-preferences";

const dbKinds: Array<{ key: DbKind; label: string; defaultPort: string }> = [
  { key: "mysql", label: "MySQL", defaultPort: "3306" },
  { key: "postgresql", label: "PostgreSQL", defaultPort: "5432" },
  { key: "sqlserver", label: "SQL Server", defaultPort: "1433" },
  { key: "oracle", label: "Oracle", defaultPort: "1521" },
  { key: "sqlite", label: "SQLite", defaultPort: "" },
];

const dbKindLabel: Record<DbKind, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlserver: "SQL Server",
  oracle: "Oracle",
  sqlite: "SQLite",
};

/** 覆盖 globals 中 `button` 的蓝底圆角，深色下用 slate 面避免白块刺眼 */
const DS_BTN_SECONDARY_SM =
  "!rounded-lg border border-slate-300 !bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-none hover:!bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:!bg-slate-800 dark:text-slate-200 dark:hover:!bg-slate-700";
const DS_BTN_SECONDARY_LG =
  "!rounded-xl border border-slate-300 !bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:!bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:!bg-slate-800 dark:text-slate-200 dark:hover:!bg-slate-700";
const DS_BTN_TAB_INACTIVE =
  "!flex items-center !rounded-xl border border-slate-300 !bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:!bg-slate-50 dark:border-slate-600 dark:!bg-slate-800 dark:text-slate-200 dark:hover:!bg-slate-700";
const DS_BTN_NEUTRAL =
  "!rounded-xl !bg-slate-100 px-4 py-2 text-sm !text-slate-700 hover:!bg-slate-200 disabled:opacity-60 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700";
const DS_BTN_COPY_DIAG =
  "!rounded-lg border border-slate-200 !bg-white px-3 py-1.5 text-xs !text-slate-700 shadow-sm hover:!bg-slate-50 dark:border-slate-600 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700";

function toStoredConfig(form: DataSourceForm): DataSourceStoredConfig {
  return { ...form };
}

function defaultForm(type: DataSourceType): DataSourceForm {
  if (type === "db") {
    return { name: "", type, dbKind: "mysql", port: "3306" };
  }
  return { name: "", type };
}

/**
 * DataSourceManager：列表展示已添加的数据源；通过弹窗填写表单并做连通性测试。
 */
export function DataSourceManager() {
  const { t, locale } = useI18n();
  const tabItems = useMemo(
    () =>
      [
        { key: "db" as const, label: "DB" },
        { key: "api" as const, label: "API" },
        { key: "file" as const, label: t("data.tab.file") },
        { key: "dcoos" as const, label: "Dcoos" },
      ] as const,
    [t],
  );
  const typeLabelResolved = useMemo(
    (): Record<DataSourceType, string> => ({
      db: "DB",
      api: "API",
      file: t("data.tab.file"),
      dcoos: "Dcoos",
    }),
    [t],
  );
  const fieldLabel = useCallback((key: string) => t(`data.field.${key}`) || key, [t]);
  const diagText = useCallback(
    (value?: string) => {
      if (!value) return t("data.diag.empty");
      const k = `data.diag.${value}`;
      const tr = t(k);
      return tr === k ? value : tr;
    },
    [t],
  );
  const [sources, setSources] = useState<DataSourceRecord[]>([]);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<DataSourceType>("db");
  const [form, setForm] = useState<DataSourceForm>(defaultForm("db"));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message?: string;
    errorCode?: string;
    diagnostics?: { network?: string; auth?: string; queryProbe?: string };
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fieldTargetId, setFieldTargetId] = useState<string | null>(null);
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [pickedFields, setPickedFields] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);

  const fields = useMemo(() => {
    switch (tab) {
      case "db":
        return ["name", "dbKind", "host", "port", "database", "table", "username", "password"];
      case "api":
        return ["name", "url", "method", "authType"];
      case "file":
        return ["name", "host", "port", "rootPath", "username", "keyPath"];
      case "dcoos":
        return ["name", "endpoint", "appId", "appSecret"];
      default:
        return ["name"];
    }
  }, [tab]);

  function reloadFromStorage() {
    try {
      const list = loadDataSourcesFromStorage();
      setSources(list);
    } catch {
      // ignore
    } finally {
      setSourcesReady(true);
    }
  }

  /** 从 localStorage 恢复列表（刷新后保留） */
  useEffect(() => {
    reloadFromStorage();
  }, []);

  /** 聊天侧「配置数据源」保存等写入同一 key 后通知刷新 */
  useEffect(() => {
    function onSync() {
      reloadFromStorage();
    }
    window.addEventListener("datacenter-datasources-changed", onSync);
    window.addEventListener("storage", onSync);
    window.addEventListener("xingyan-data-scope-changed", onSync);
    return () => {
      window.removeEventListener("datacenter-datasources-changed", onSync);
      window.removeEventListener("storage", onSync);
      window.removeEventListener("xingyan-data-scope-changed", onSync);
    };
  }, []);

  /** 列表变更后写回 localStorage */
  useEffect(() => {
    if (!sourcesReady) return;
    saveDataSourcesToStorage(sources);
  }, [sources, sourcesReady]);

  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  /** 弹窗打开时禁止背后页面随滚轮滚动 */
  useEffect(() => {
    if (!modalOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [modalOpen]);

  function openModal() {
    setTab("db");
    setForm(defaultForm("db"));
    setResult(null);
    setFormError(null);
    setEditingId(null);
    setModalOpen(true);
  }

  function openEditModal(row: DataSourceRecord) {
    setTab(row.type);
    setForm({
      ...defaultForm(row.type),
      ...row.config,
      name: row.name,
      type: row.type,
    });
    setResult(null);
    setFormError(null);
    setEditingId(row.id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
  }

  function switchTab(next: DataSourceType) {
    setTab(next);
    setForm(defaultForm(next));
    setResult(null);
    setFormError(null);
  }

  async function testConnectivity() {
    if (tab === "db") {
      if (!form.dbKind) {
        setResult({
          ok: false,
          latencyMs: 0,
          message: t("data.val.pickDbKind"),
          errorCode: "DB_KIND_REQUIRED",
          diagnostics: {},
        });
        return;
      }
      if (!form.database?.trim() || !form.table?.trim()) {
        setResult({
          ok: false,
          latencyMs: 0,
          message: t("data.val.dbNeedsTable"),
          errorCode: "DB_TABLE_REQUIRED",
          diagnostics: {},
        });
        return;
      }
    }
    setTesting(true);
    setResult(null);
    const payload = { ...form, type: tab };
    try {
      const res = await fetch("/api/datasource/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setResult({
        ok: !!data.ok,
        latencyMs: Number(data.latencyMs ?? 0),
        message: data.message ?? "",
        errorCode: data.errorCode ?? "",
        diagnostics: data.diagnostics ?? {},
      });
    } finally {
      setTesting(false);
    }
  }

  function addSource() {
    const name = form.name.trim();
    if (!name) {
      setFormError(t("data.val.name"));
      return;
    }
    if (tab === "db") {
      if (!form.dbKind) {
        setFormError(t("data.val.dbKind"));
        return;
      }
      if (!form.database?.trim() || !form.table?.trim()) {
        setFormError(t("data.val.dbTableRequired"));
        return;
      }
    }
    setFormError(null);
    const prevSelectedFields = editingId
      ? sources.find((x) => x.id === editingId)?.config.selectedFields ?? []
      : [];
    const nextForm: DataSourceForm = {
      ...form,
      type: tab,
      name,
      selectedFields: form.selectedFields ?? prevSelectedFields,
    };
    if (editingId) {
      setSources((s) =>
        s.map((item) =>
          item.id === editingId
            ? {
                ...item,
                name,
                type: tab,
                summary: connectionSummary(nextForm),
                config: toStoredConfig(nextForm),
              }
            : item,
        ),
      );
    } else {
      const row: DataSourceRecord = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ds-${Date.now()}`,
        name,
        type: tab,
        summary: connectionSummary(nextForm),
        createdAt: new Date().toISOString(),
        config: toStoredConfig(nextForm),
      };
      setSources((s) => [row, ...s]);
    }
    closeModal();
  }

  function removeSource(id: string) {
    setSources((s) => s.filter((x) => x.id !== id));
  }

  function openFieldModal(row: DataSourceRecord) {
    setFieldError(null);
    setPreviewError(null);
    setFieldTargetId(row.id);
    const saved = row.config.selectedFields ?? [];
    // 弹窗首次打开先展示已保存字段，避免“角标有值但内容为空”
    setAvailableFields(saved);
    setPickedFields(saved);
    setPreviewRows([]);
    setFieldModalOpen(true);
  }

  async function fetchFields() {
    if (!fieldTargetId) return;
    const row = sources.find((x) => x.id === fieldTargetId);
    if (!row) return;
    setFieldError(null);
    setFieldLoading(true);
    try {
      const res = await fetch("/api/datasource/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...row.config,
          type: row.type,
          name: row.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFieldError(data.message ?? t("data.fieldLoadFail"));
        return;
      }
      const fields = Array.isArray(data.fields) ? data.fields : [];
      setAvailableFields(fields);
      // 以已保存配置为准回填勾选，避免弹窗局部状态导致“再次打开不回显”
      const savedPicked = row.config.selectedFields ?? [];
      setPickedFields(savedPicked.filter((f) => fields.includes(f)));
    } finally {
      setFieldLoading(false);
    }
  }

  async function fetchPreviewRows() {
    if (!fieldTargetId) return;
    const row = sources.find((x) => x.id === fieldTargetId);
    if (!row) return;
    if (!availableFields.length) {
      setPreviewError(t("data.previewHintRefresh"));
      return;
    }
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/datasource/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...row.config,
          type: row.type,
          name: row.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPreviewError(data.message ?? t("data.previewLoadFail"));
        return;
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setPreviewRows(rows);
    } finally {
      setPreviewLoading(false);
    }
  }

  function togglePicked(field: string) {
    setPickedFields((s) => (s.includes(field) ? s.filter((x) => x !== field) : [...s, field]));
  }

  function savePickedFields() {
    if (!fieldTargetId) return;
    setSources((s) =>
      s.map((item) =>
        item.id === fieldTargetId
          ? {
              ...item,
              config: {
                ...item.config,
                selectedFields: pickedFields,
              },
            }
          : item,
      ),
    );
    setFieldModalOpen(false);
    setFieldTargetId(null);
  }

  function formatTime(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(intlLocaleForApp(locale), { hour12: false });
    } catch {
      return iso;
    }
  }

  return (
    <>
      <section className="task-card">
        <div className="panel-title-row">
          <h3>{t("data.title")}</h3>
          <button type="button" onClick={openModal}>
            {t("data.addSource")}
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("data.emptyHint")}</p>
        ) : (
          <div className="table-wrap mt-3">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t("data.field.name")}</TableHeaderCell>
                  <TableHeaderCell>{t("data.colType")}</TableHeaderCell>
                  <TableHeaderCell>{t("data.colSummary")}</TableHeaderCell>
                  <TableHeaderCell>{t("data.colAddedAt")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("data.colAction")}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sources.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{typeLabelResolved[row.type]}</TableCell>
                    <TableCell className="max-w-[240px] truncate">
                      <span title={row.summary}>{row.summary}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      {formatTime(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          title={
                            row.config.selectedFields?.length
                              ? t("data.fieldsSelected", { count: String(row.config.selectedFields.length) })
                              : t("data.fields")
                          }
                          className="relative rounded-full bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:outline-slate-500"
                          onClick={() => openFieldModal(row)}
                        >
                          <ListFilter className="size-4" />
                          {row.config.selectedFields?.length ? (
                            <span className="absolute -right-1 -top-1 rounded-full bg-blue-600 px-1.5 text-[10px] leading-4 text-white">
                              {row.config.selectedFields.length}
                            </span>
                          ) : null}
                        </button>
                        <ActionIconButton
                          title={t("data.editTooltip")}
                          variant="edit"
                          onClick={() => openEditModal(row)}
                        />
                        <ActionIconButton
                          title={t("data.deleteTooltip")}
                          variant="delete"
                          onClick={() => removeSource(row.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {modalOpen ? (
        <div
          className="scrollbar-none fixed inset-0 z-50 overflow-y-auto overscroll-none bg-slate-900/35 backdrop-blur-[2px]"
          role="presentation"
          onClick={closeModal}
        >
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-600 dark:bg-slate-900"
              role="dialog"
              aria-modal="true"
              aria-labelledby="datasource-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
            <div>
              <h3 id="datasource-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? t("data.modalEdit") : t("data.modalAdd")}
              </h3>
            </div>

            {/* 与系统管理「新增模型」表单区一致的嵌套卡片 */}
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-slate-900">
              <div className="flex flex-wrap gap-2">
                {tabItems.map((tabItem) => (
                  <button
                    key={tabItem.key}
                    type="button"
                    onClick={() => switchTab(tabItem.key)}
                    className={
                      tab === tabItem.key
                        ? "!rounded-xl px-4 py-2 text-sm font-medium !bg-blue-600 !text-white shadow-sm hover:!bg-blue-700 dark:hover:!bg-blue-500"
                        : DS_BTN_TAB_INACTIVE
                    }
                  >
                    {tabItem.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid content-start grid-cols-1 gap-3 md:grid-cols-2">
                {fields.map((f) => (
                  <label key={f} className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {fieldLabel(f)}
                    {f === "dbKind" ? (
                      <select
                        className="mt-1"
                        value={form.dbKind ?? "mysql"}
                        onChange={(e) => {
                          const nextKind = e.target.value as DbKind;
                          const nextDefaultPort =
                            dbKinds.find((item) => item.key === nextKind)?.defaultPort ?? "";
                          setFormError(null);
                          setForm((s) => ({
                            ...s,
                            dbKind: nextKind,
                            port: s.port?.trim() ? s.port : nextDefaultPort,
                          }));
                        }}
                      >
                        {dbKinds.map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="mt-1"
                        type={
                          f.toLowerCase().includes("password") || f.toLowerCase().includes("secret")
                            ? "password"
                            : "text"
                        }
                        value={String((form as unknown as Record<string, string | undefined>)[f] ?? "")}
                        onChange={(e) => {
                          setFormError(null);
                          setForm((s) => ({ ...s, [f]: e.target.value }));
                        }}
                      />
                    )}
                  </label>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={testing}
                    className={DS_BTN_NEUTRAL}
                    onClick={testConnectivity}
                  >
                    {testing ? t("data.testing") : t("data.testConnection")}
                  </button>
                </div>
                {result ? (
                  <div
                    className={`rounded-xl border p-3 text-sm ${
                      result.ok
                        ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                        : "border-rose-200 bg-rose-50/80 text-rose-900"
                    }`}
                  >
                    <div>
                      {formatMessage(t("data.resultLatency"), {
                        status: result.ok ? t("data.resultOk") : t("data.resultFail"),
                        ms: String(result.latencyMs),
                      })}
                      {result.errorCode ? `（${result.errorCode}）` : ""}
                    </div>
                    {result.message ? <div className="mt-1 text-xs opacity-90">{result.message}</div> : null}
                    {result.diagnostics ? (
                      <div className="mt-2 grid gap-1 text-xs opacity-90">
                        <div>
                          {t("data.diagNet")}：{diagText(result.diagnostics.network)}
                        </div>
                        <div>
                          {t("data.diagAuth")}：{diagText(result.diagnostics.auth)}
                        </div>
                        <div>
                          {t("data.diagQuery")}：{diagText(result.diagnostics.queryProbe)}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={DS_BTN_COPY_DIAG}
                        onClick={async () => {
                          if (!result) return;
                          const text = JSON.stringify(
                            {
                              errorCode: result.errorCode,
                              message: result.message,
                              diagnostics: result.diagnostics,
                            },
                            null,
                            2,
                          );
                          try {
                            await navigator.clipboard.writeText(text);
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        {t("data.copyDiag")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {formError ? (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-5 dark:border-slate-800">
              <button type="button" onClick={closeModal} className={DS_BTN_SECONDARY_LG}>
                {t("data.cancel")}
              </button>
              <button
                type="button"
                onClick={addSource}
                className="!rounded-xl px-4 py-2 text-sm font-medium hover:!bg-blue-700 dark:hover:!bg-blue-500"
              >
                {editingId ? t("data.saveChanges") : t("data.addToList")}
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {fieldModalOpen ? (
        <div
          className="scrollbar-none fixed inset-0 z-50 overflow-y-auto overscroll-none bg-slate-900/35 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => {
            setFieldModalOpen(false);
            setFieldTargetId(null);
          }}
        >
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-600 dark:bg-slate-900"
              role="dialog"
              aria-modal="true"
              aria-labelledby="field-picker-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="field-picker-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t("data.selectFieldsTitle")}
              </h3>
              {fieldLoading ? (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("data.fieldLoading")}</p>
              ) : null}
              {fieldError ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{fieldError}</p> : null}
              {!fieldLoading && !fieldError ? (
                <>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className={DS_BTN_SECONDARY_SM} onClick={fetchFields} disabled={fieldLoading}>
                      {fieldLoading ? t("data.fieldLoading") : t("data.btnRefreshFields")}
                    </button>
                    <button
                      type="button"
                      className={DS_BTN_SECONDARY_SM}
                      onClick={fetchPreviewRows}
                      disabled={previewLoading}
                    >
                      {previewLoading ? t("data.previewLoading") : t("data.btnFetchData")}
                    </button>
                    <button type="button" className={DS_BTN_SECONDARY_SM} onClick={() => setPickedFields(availableFields)}>
                      {t("data.selectAll")}
                    </button>
                    <button type="button" className={DS_BTN_SECONDARY_SM} onClick={() => setPickedFields([])}>
                      {t("data.clear")}
                    </button>
                  </div>
                  {previewError ? (
                    <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{previewError}</p>
                  ) : null}
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3 dark:border-slate-700 dark:bg-slate-950/50">
                    <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t("data.previewTitle")}</p>
                    {availableFields.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">{t("data.previewHintRefresh")}</p>
                    ) : (
                      <div className="table-wrap max-h-[min(70vh,720px)] overflow-auto rounded-lg border border-slate-200/90 [color-scheme:light] dark:border-slate-700 dark:[color-scheme:dark]">
                        {/*
                          多列时勿用 w-full：否则每列被压成极窄，中文 break-all 会「竖排」难读。
                          min-w-max + 横向滚动；列宽 min/max + break-words 保持横向阅读。
                        */}
                        <table className="min-w-max border-separate border-spacing-0 text-left text-xs text-slate-800 dark:text-slate-200">
                          <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)] dark:shadow-[0_1px_0_0_rgb(51_65_85)]">
                            <tr className="bg-slate-100 dark:bg-slate-800">
                              {availableFields.map((c) => (
                                <th
                                  key={`pick-${c}`}
                                  className="min-w-[10rem] max-w-[13rem] border-b border-r border-slate-200 px-2 py-2 last:border-r-0 dark:border-slate-700"
                                >
                                  <div className="flex justify-center">
                                    <input
                                      type="checkbox"
                                      checked={pickedFields.includes(c)}
                                      onChange={() => togglePicked(c)}
                                      title={c}
                                      className="size-4 shrink-0 accent-blue-600 dark:accent-sky-500"
                                      aria-label={c}
                                    />
                                  </div>
                                </th>
                              ))}
                            </tr>
                            <tr className="bg-slate-100 dark:bg-slate-800">
                              {availableFields.map((c) => (
                                <th
                                  key={c}
                                  className="min-w-[10rem] max-w-[13rem] border-b border-r border-slate-200 px-2 py-2 align-top font-medium last:border-r-0 dark:border-slate-700"
                                >
                                  <span className="block max-h-28 overflow-y-auto break-words leading-snug text-slate-800 dark:text-slate-100">
                                    {c}
                                  </span>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {previewRows.length === 0 ? (
                              <tr>
                                <td
                                  className="border-b border-slate-100 px-3 py-4 text-slate-500 dark:border-slate-800 dark:text-slate-400"
                                  colSpan={availableFields.length}
                                >
                                  {t("data.previewClickFetch")}
                                </td>
                              </tr>
                            ) : (
                              previewRows.map((r, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-slate-100 odd:bg-white even:bg-slate-50/90 dark:border-slate-800 dark:odd:bg-slate-900/80 dark:even:bg-slate-800/50"
                                >
                                  {availableFields.map((c) => (
                                    <td
                                      key={c}
                                      className="min-w-[10rem] max-w-[13rem] border-r border-slate-100 px-2 py-2 align-top break-words leading-relaxed last:border-r-0 dark:border-slate-800"
                                      title={formatDatasourcePreviewCell((r as Record<string, unknown>)[c], 8000)}
                                    >
                                      {formatDatasourcePreviewCell((r as Record<string, unknown>)[c])}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setFieldModalOpen(false);
                    setFieldTargetId(null);
                  }}
                  className={DS_BTN_SECONDARY_LG}
                >
                  {t("data.cancel")}
                </button>
                <button
                  type="button"
                  onClick={savePickedFields}
                  className="!rounded-xl px-4 py-2 text-sm font-medium hover:!bg-blue-700 dark:hover:!bg-blue-500"
                >
                  {t("data.fieldSave")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
