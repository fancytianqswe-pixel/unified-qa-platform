"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DataSourceRecord } from "@/components/data/types";
import type { DatasourceDraftPayload, DatasourceDraftUiState } from "@/components/chat/types";
import { appendDataSourceRecord } from "@/lib/datasource-storage";
import { formatDatasourcePreviewCell } from "@/lib/datasource-preview-cell";
import { isDatasourcePasswordPlaceholder } from "@/lib/datasource-password";
import { resolveDatasourceDraftUi } from "@/lib/datasource-draft-state";
import { useChatStore } from "@/store/chatStore";
import { Database, Loader2 } from "lucide-react";

type Props = {
  payload: DatasourceDraftPayload;
};

function toApiBody(
  rec: DataSourceRecord,
  opts?: { selectedFields?: string[]; passwordOverride?: string },
) {
  const c = rec.config;
  const password =
    opts?.passwordOverride?.trim() ||
    (typeof c.password === "string" ? c.password : "");
  const body: Record<string, unknown> = {
    name: rec.name,
    type: rec.type,
    dbKind: c.dbKind,
    host: c.host,
    port: c.port,
    username: c.username,
    password,
    database: c.database,
    table: c.table,
  };
  if (opts?.selectedFields?.length) {
    body.selectedFields = opts.selectedFields;
  }
  return body;
}

function initialPasswordDraft(record: DataSourceRecord, saved: DatasourceDraftUiState | null): string {
  if (saved?.passwordOverride?.trim()) return saved.passwordOverride.trim();
  const pwd = String(record.config.password ?? "");
  return isDatasourcePasswordPlaceholder(pwd) ? "" : pwd;
}

export function DatasourceDraftCard({ payload }: Props) {
  const setDatasourceWizardActive = useChatStore((s) => s.setDatasourceWizardActive);
  const patchDatasourceDraftCard = useChatStore((s) => s.patchDatasourceDraftCard);
  const recordId = payload.record.id;
  const recordIdRef = useRef(recordId);
  recordIdRef.current = recordId;

  const savedDraft = resolveDatasourceDraftUi(payload.record, payload.draft);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message?: string;
    latencyMs?: number;
    forRecordId: string;
  } | null>(() =>
    savedDraft?.testResult
      ? { ...savedDraft.testResult, forRecordId: recordId }
      : null,
  );
  const [testLoading, setTestLoading] = useState(false);

  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [availableFields, setAvailableFields] = useState<string[]>(() => savedDraft?.availableFields ?? []);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>(
    () => savedDraft?.previewRows ?? [],
  );

  const [pickedFields, setPickedFields] = useState<string[]>(() => savedDraft?.pickedFields ?? []);
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedFinal, setSavedFinal] = useState(() => !!savedDraft?.savedFinal);
  const configPassword = String(payload.record.config.password ?? "");
  const passwordIsPlaceholder = isDatasourcePasswordPlaceholder(configPassword);
  const [passwordDraft, setPasswordDraft] = useState(() =>
    initialPasswordDraft(payload.record, savedDraft),
  );

  const autoFieldsDoneFor = useRef<string | null>(null);
  const passwordPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMysql = String(payload.record.config.dbKind ?? "").toLowerCase() === "mysql";
  const testAppliesToCard = testResult != null && testResult.forRecordId === recordId;
  const testOk = testAppliesToCard && testResult.ok === true;
  const canFieldTools = isMysql && testOk;

  const persistDraft = useCallback(
    (draft: Partial<DatasourceDraftUiState>, recordConfigPatch?: { password?: string }) => {
      patchDatasourceDraftCard(recordIdRef.current, { draft, recordConfigPatch });
    },
    [patchDatasourceDraftCard],
  );

  /** 切换草稿 record 或指纹变化时：从消息内 draft 恢复，而非清空 */
  useEffect(() => {
    const saved = resolveDatasourceDraftUi(payload.record, payload.draft);
    autoFieldsDoneFor.current = null;
    setFieldsError(null);
    setPreviewError(null);
    if (!saved) {
      setTestResult(null);
      setAvailableFields([]);
      setPreviewRows([]);
      setPickedFields([]);
      setSavedFinal(false);
      const nextPwd = String(payload.record.config.password ?? "");
      setPasswordDraft(isDatasourcePasswordPlaceholder(nextPwd) ? "" : nextPwd);
      return;
    }
    setTestResult(
      saved.testResult ? { ...saved.testResult, forRecordId: recordId } : null,
    );
    setAvailableFields(saved.availableFields ?? []);
    setPickedFields(saved.pickedFields ?? []);
    setPreviewRows(saved.previewRows ?? []);
    setSavedFinal(!!saved.savedFinal);
    setPasswordDraft(initialPasswordDraft(payload.record, saved));
    if (saved.availableFields?.length) {
      autoFieldsDoneFor.current = recordId;
    }
  }, [recordId, payload.record, payload.draft]);

  const effectivePassword = passwordDraft.trim() || configPassword;

  useEffect(() => {
    return () => {
      if (passwordPersistTimer.current) clearTimeout(passwordPersistTimer.current);
    };
  }, []);

  const schedulePasswordPersist = useCallback(
    (pwd: string) => {
      if (passwordPersistTimer.current) clearTimeout(passwordPersistTimer.current);
      passwordPersistTimer.current = setTimeout(() => {
        const trimmed = pwd.trim();
        if (!trimmed || isDatasourcePasswordPlaceholder(trimmed)) return;
        persistDraft(
          { passwordOverride: trimmed },
          isDatasourcePasswordPlaceholder(configPassword) ? { password: trimmed } : undefined,
        );
      }, 400);
    },
    [configPassword, persistDraft],
  );

  const runTest = useCallback(async () => {
    const attemptRecordId = recordIdRef.current;
    setTestLoading(true);
    setTestResult(null);
    setFieldsError(null);
    setAvailableFields([]);
    setPreviewRows([]);
    setPickedFields([]);
    try {
      const res = await fetch("/api/datasource/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiBody(payload.record, { passwordOverride: effectivePassword })),
      });
      if (recordIdRef.current !== attemptRecordId) return;
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        latencyMs?: number;
      };
      const nextResult = {
        ok: !!data.ok,
        message: data.message ?? (data.ok ? "探测成功" : "探测失败"),
        latencyMs: data.latencyMs,
        forRecordId: attemptRecordId,
      };
      setTestResult(nextResult);
      persistDraft({
        testResult: {
          ok: nextResult.ok,
          message: nextResult.message,
          latencyMs: nextResult.latencyMs,
        },
        passwordOverride: passwordDraft.trim() || undefined,
      });
    } catch {
      if (recordIdRef.current !== attemptRecordId) return;
      const fail = { ok: false, message: "请求失败，请检查网络", forRecordId: attemptRecordId };
      setTestResult(fail);
      persistDraft({ testResult: { ok: false, message: fail.message } });
    } finally {
      setTestLoading(false);
    }
  }, [payload.record, effectivePassword, passwordDraft, persistDraft]);

  /** 首次无已保存探测结果时自动测连；重新进入会话则沿用 draft，不再清空重跑 */
  useEffect(() => {
    if (savedDraft?.testResult) return;
    if (isDatasourcePasswordPlaceholder(effectivePassword)) return;
    void runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: once per recordId
  }, [recordId]);

  const runFetchFields = useCallback(async () => {
    if (!canFieldTools) return;
    setFieldsLoading(true);
    setFieldsError(null);
    setAvailableFields([]);
    setPreviewRows([]);
    try {
      const res = await fetch("/api/datasource/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiBody(payload.record, { passwordOverride: effectivePassword })),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFieldsError(data.message ?? "读取字段失败");
        return;
      }
      const fields = Array.isArray(data.fields) ? (data.fields as string[]) : [];
      setAvailableFields(fields);
      setPickedFields(fields);
      persistDraft({ availableFields: fields, pickedFields: fields });
    } finally {
      setFieldsLoading(false);
    }
  }, [payload.record, canFieldTools, effectivePassword, persistDraft]);

  /** MySQL 且连通性通过后自动拉字段（用户仍可手动点「更新字段」刷新） */
  useEffect(() => {
    if (availableFields.length > 0) return;
    if (!isMysql || !testOk) return;
    if (autoFieldsDoneFor.current === recordId) return;
    autoFieldsDoneFor.current = recordId;
    void runFetchFields();
  }, [recordId, isMysql, testOk, availableFields.length, runFetchFields]);

  const runPreview = useCallback(async () => {
    if (!canFieldTools) {
      setPreviewError("请先通过连通性检测");
      return;
    }
    if (!availableFields.length) {
      setPreviewError("请先点击「更新字段」");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/datasource/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          toApiBody(payload.record, {
            selectedFields: pickedFields.length ? pickedFields : undefined,
            passwordOverride: effectivePassword,
          }),
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPreviewError(data.message ?? "读取示例数据失败");
        return;
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setPreviewRows(rows);
      persistDraft({ previewRows: rows });
    } finally {
      setPreviewLoading(false);
    }
  }, [payload.record, canFieldTools, availableFields.length, pickedFields, effectivePassword, persistDraft]);

  function toggleField(f: string) {
    setPickedFields((s) => {
      const next = s.includes(f) ? s.filter((x) => x !== f) : [...s, f];
      persistDraft({ pickedFields: next });
      return next;
    });
  }

  function selectAll() {
    const next = [...availableFields];
    setPickedFields(next);
    persistDraft({ pickedFields: next });
  }

  function clearAll() {
    setPickedFields([]);
    persistDraft({ pickedFields: [] });
  }

  const previewColumns = useMemo(() => {
    if (!previewRows.length) return [];
    return Object.keys(previewRows[0]);
  }, [previewRows]);

  async function onSaveFinal() {
    if (saveLoading || savedFinal) return;
    if (!testOk) return;
    if (isMysql && availableFields.length && pickedFields.length === 0) {
      return;
    }
    setSaveLoading(true);
    try {
      const next: DataSourceRecord = {
        ...payload.record,
        config: {
          ...payload.record.config,
          password: effectivePassword,
          selectedFields: isMysql && availableFields.length ? pickedFields : pickedFields.length ? pickedFields : undefined,
        },
      };
      appendDataSourceRecord(next);
      window.dispatchEvent(new CustomEvent("datacenter-datasources-changed"));
      setDatasourceWizardActive(false);
      setSavedFinal(true);
      persistDraft({ savedFinal: true, passwordOverride: effectivePassword });
    } finally {
      setSaveLoading(false);
    }
  }

  const { record } = payload;

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-sm text-sky-950 shadow-sm">
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 size-5 shrink-0 text-sky-600" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-semibold">数据源配置（由对话生成）</p>
            <p className="mt-1 text-sky-900/90">
              <span className="font-medium">{record.name}</span>
              <span className="mx-1 text-sky-600">·</span>
              <span className="text-sky-800">{record.summary}</span>
            </p>
          </div>

          {!isMysql ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              当前非 MySQL 时，「更新字段 / 获取数据」仅在数据中心侧扩展；仍可先做连通性检测后保存。
            </p>
          ) : null}

          {passwordIsPlaceholder ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-950">
              <p className="font-medium">配置块中的密码为占位符（如 ***），无法用于真实探测</p>
              <label className="mt-2 block">
                <span className="text-amber-900/90">请填写真实数据库密码后点「连通性检测」</span>
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPasswordDraft(v);
                    schedulePasswordPersist(v);
                  }}
                  placeholder="Root#2026!AiCursor"
                  autoComplete="off"
                  className="mt-1.5 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                />
              </label>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-100">
            <p className="text-xs font-medium text-slate-600">1. 连通性检测</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <button
                type="button"
                disabled={testLoading}
                onClick={() => void runTest()}
                className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-60"
              >
                {testLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                连通性检测
              </button>
              {testAppliesToCard && testResult ? (
                <span
                  className={`min-w-0 text-xs leading-snug sm:max-w-[min(100%,18rem)] sm:text-right sm:text-sm ${
                    testResult.ok ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {testResult.ok ? "通过" : "未通过"}
                  {testResult.latencyMs != null ? ` · ${testResult.latencyMs}ms` : ""}
                  {testResult.message ? ` · ${testResult.message}` : ""}
                </span>
              ) : null}
            </div>
            {testAppliesToCard && testResult && !testResult.ok ? (
              <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs leading-relaxed text-red-900/90">
                {hintForTestFailure(testResult.message)}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-100">
            <p className="text-xs font-medium text-slate-600">2. 更新字段（MySQL）</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <button
                type="button"
                disabled={!canFieldTools || fieldsLoading}
                onClick={() => void runFetchFields()}
                className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                {fieldsLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                更新字段
              </button>
              <div className="flex min-w-0 flex-col gap-1 text-left sm:items-end sm:text-right">
                {fieldsError ? <span className="text-xs text-red-600">{fieldsError}</span> : null}
                {availableFields.length ? (
                  <span className="text-xs text-slate-600">共 {availableFields.length} 个字段</span>
                ) : null}
              </div>
            </div>
            {availableFields.length ? (
              <div className="mt-3 max-h-36 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-2">
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="!rounded-lg border border-slate-300 !bg-white px-2 py-1 text-xs font-medium !text-slate-700 shadow-none hover:!bg-slate-50 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700"
                    onClick={selectAll}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="!rounded-lg border border-slate-300 !bg-white px-2 py-1 text-xs font-medium !text-slate-700 shadow-none hover:!bg-slate-50 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700"
                    onClick={clearAll}
                  >
                    清空
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                  {availableFields.map((f) => (
                    <label key={f} className="flex min-w-0 cursor-pointer items-center gap-1.5 text-xs text-slate-800">
                      <input
                        type="checkbox"
                        checked={pickedFields.includes(f)}
                        onChange={() => toggleField(f)}
                        className="shrink-0 rounded border-slate-300"
                      />
                      <span className="min-w-0 truncate" title={f}>
                        {f}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-100">
            <p className="text-xs font-medium text-slate-600">3. 获取数据（样例最多 5 行）</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <button
                type="button"
                disabled={!canFieldTools || !availableFields.length || previewLoading}
                onClick={() => void runPreview()}
                className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                {previewLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                获取数据
              </button>
              {previewError ? (
                <span className="min-w-0 text-xs text-red-600 sm:max-w-[min(100%,20rem)] sm:text-right">{previewError}</span>
              ) : null}
            </div>
            {previewRows.length > 0 ? (
              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-100">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-left text-slate-700">
                      {previewColumns.map((c) => (
                        <th key={c} className="whitespace-nowrap border-b border-slate-200 px-2 py-1 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} className="border-b border-slate-100">
                        {previewColumns.map((c) => (
                          <td
                            key={c}
                            className="max-w-[140px] truncate px-2 py-1 text-slate-800"
                            title={formatDatasourcePreviewCell(row[c], 8000)}
                          >
                            {formatCell(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-sky-200/60 pt-2">
            {!savedFinal ? (
              <button
                type="button"
                disabled={
                  saveLoading ||
                  !testOk ||
                  (isMysql && !!availableFields.length && pickedFields.length === 0)
                }
                onClick={() => void onSaveFinal()}
                title={
                  !testOk
                    ? "请先通过连通性检测"
                    : isMysql && availableFields.length && !pickedFields.length
                      ? "请至少勾选一个字段"
                      : undefined
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
              >
                {saveLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                保存到数据中心（含已选字段）
              </button>
            ) : (
              <span className="text-sm font-medium text-emerald-700">已保存</span>
            )}
            <Link
              href="/data-center"
              className="text-sm font-medium text-sky-800 underline decoration-sky-400 underline-offset-2 hover:text-sky-950"
            >
              打开数据中心
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCell(v: unknown) {
  const s = formatDatasourcePreviewCell(v, 200);
  return s === "-" ? "" : s;
}

function hintForTestFailure(message?: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("占位符") || m.includes("placeholder")) {
    return "助手在 hermes-datasource 块里写了 *** 等掩码，平台会按字面密码连库。请在上方输入框填写 Root#2026!AiCursor（或你的真实口令），或让助手在配置块中输出完整 password 后重新生成卡片。";
  }
  if (m.includes("econnrefused") || m.includes("拒绝连接")) {
    return "表示该地址与端口上没有数据库在监听。请确认本机 MySQL 已启动且端口正确（例如默认 3306）；若库跑在 Docker 里，主机有时需填 host.docker.internal 或容器网络地址，而不是宿主机的 127.0.0.1。改好后可在对话里让助手重新输出配置，或到数据中心编辑后再测。";
  }
  if (m.includes("access denied") || m.includes("1045")) {
    return "多为用户名或密码错误，请在对话中更正后让助手重新生成配置块。";
  }
  if (m.includes("unknown database") || m.includes("1049")) {
    return "数据库名可能不存在或无权访问，请核对库名后重新生成配置。";
  }
  if (m.includes("doesn't exist") && m.includes("table")) {
    return "请核对数据表名是否存在、大小写是否与库中一致。";
  }
  return "请根据上方错误排查网络、账号与库表信息；也可打开数据中心编辑该数据源后再次检测。";
}
