"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatMessage } from "@/i18n/registry";
import type { McpServicePublic, McpTransport } from "@/lib/mcp-services-types";
import { MCP_TRANSPORTS } from "@/lib/mcp-services-types";
import type { RegisteredBuiltinMcpRow } from "@/lib/mcp-platform-backend";

const DEFAULT_JSON = `{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-xxx"]
    }
  }
}`;

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: "STDIO",
  sse: "SSE",
  streamable_http: "Streamable HTTP",
  json: "JSON",
};

type Kv = { key: string; value: string };

type FormState = {
  transport: McpTransport;
  name: string;
  command: string;
  argsText: string;
  envRows: Kv[];
  url: string;
  headerRows: Kv[];
  jsonText: string;
};

function emptyForm(): FormState {
  return {
    transport: "stdio",
    name: "",
    command: "",
    argsText: "",
    envRows: [{ key: "", value: "" }],
    url: "",
    headerRows: [{ key: "", value: "" }],
    jsonText: DEFAULT_JSON,
  };
}

function serviceToForm(s: McpServicePublic): FormState {
  const d = s.definition;
  if (s.transport === "stdio") {
    const args = Array.isArray(d.args) ? (d.args as unknown[]).map(String).join(" ") : "";
    const env = d.env && typeof d.env === "object" && !Array.isArray(d.env) ? (d.env as Record<string, string>) : {};
    const envRows = Object.keys(env).length ? Object.entries(env).map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }];
    return {
      transport: "stdio",
      name: s.name,
      command: String(d.command ?? ""),
      argsText: args,
      envRows,
      url: "",
      headerRows: [{ key: "", value: "" }],
      jsonText: DEFAULT_JSON,
    };
  }
  if (s.transport === "sse" || s.transport === "streamable_http") {
    const headers =
      d.headers && typeof d.headers === "object" && !Array.isArray(d.headers)
        ? (d.headers as Record<string, string>)
        : {};
    const headerRows = Object.keys(headers).length
      ? Object.entries(headers).map(([key, value]) => ({ key, value }))
      : [{ key: "", value: "" }];
    return {
      transport: s.transport,
      name: s.name,
      command: "",
      argsText: "",
      envRows: [{ key: "", value: "" }],
      url: String(d.url ?? ""),
      headerRows,
      jsonText: DEFAULT_JSON,
    };
  }
  return {
    transport: "json",
    name: s.name,
    command: "",
    argsText: "",
    envRows: [{ key: "", value: "" }],
    url: "",
    headerRows: [{ key: "", value: "" }],
    jsonText: JSON.stringify(d, null, 2),
  };
}

function buildDefinition(f: FormState): Record<string, unknown> {
  if (f.transport === "stdio") {
    const env: Record<string, string> = {};
    for (const row of f.envRows) {
      const k = row.key.trim();
      if (k) env[k] = row.value;
    }
    return {
      command: f.command.trim(),
      argsText: f.argsText.trim(),
      env,
    };
  }
  if (f.transport === "sse" || f.transport === "streamable_http") {
    const headers: Record<string, string> = {};
    for (const row of f.headerRows) {
      const k = row.key.trim();
      if (k) headers[k] = row.value;
    }
    return { url: f.url.trim(), headers };
  }
  return { rawJson: f.jsonText };
}

function summaryLine(
  s: McpServicePublic,
  tr: (key: string, vars?: Record<string, string>) => string,
): string {
  const d = s.definition;
  if (s.transport === "stdio") {
    const cmd = String(d.command ?? "");
    return cmd.length > 96 ? `${cmd.slice(0, 96)}…` : cmd || "—";
  }
  if (s.transport === "sse" || s.transport === "streamable_http") {
    return String(d.url ?? "—");
  }
  try {
    const o = d as { mcpServers?: Record<string, unknown> };
    const n = o.mcpServers && typeof o.mcpServers === "object" ? Object.keys(o.mcpServers).length : 0;
    return n ? formatMessage(tr("mcp.jsonSummary"), { n: String(n) }) : tr("mcp.jsonConfig");
  } catch {
    return tr("mcp.jsonConfig");
  }
}

function purposeForCustomService(s: McpServicePublic, tr: (key: string) => string): string {
  if (s.transport === "stdio") return tr("mcp.transport.stdio");
  if (s.transport === "sse" || s.transport === "streamable_http") {
    return tr("mcp.transport.remote");
  }
  return tr("mcp.transport.json");
}

/** 系统管理 → MCP 服务：自定义 MCP 服务器配置（平台库持久化）。 */
export function McpServicesSection() {
  const { t } = useI18n();
  const [list, setList] = useState<McpServicePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [builtinServicesEnabled, setBuiltinServicesEnabled] = useState(true);
  const [registeredBuiltinMcps, setRegisteredBuiltinMcps] = useState<RegisteredBuiltinMcpRow[]>([]);
  const [builtinConnected, setBuiltinConnected] = useState(false);
  const [builtinLoading, setBuiltinLoading] = useState(true);
  const [builtinSaving, setBuiltinSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadBuiltin = useCallback(async () => {
    setBuiltinLoading(true);
    try {
      const res = await fetch("/api/system/mcp-builtin");
      const data = (await res.json()) as {
        ok?: boolean;
        builtinServicesEnabled?: boolean;
        registeredBuiltinMcps?: RegisteredBuiltinMcpRow[];
        connected?: boolean;
      };
      if (res.ok && data.ok) {
        setBuiltinServicesEnabled(Boolean(data.builtinServicesEnabled));
        setRegisteredBuiltinMcps(Array.isArray(data.registeredBuiltinMcps) ? data.registeredBuiltinMcps : []);
        setBuiltinConnected(data.connected !== false);
      } else {
        setBuiltinServicesEnabled(false);
        setRegisteredBuiltinMcps([]);
        setBuiltinConnected(false);
      }
    } catch {
      setBuiltinConnected(false);
    } finally {
      setBuiltinLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/system/mcp-services");
      const data = (await res.json()) as {
        ok?: boolean;
        list?: McpServicePublic[];
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setList([]);
        setListError(data.message || t("mcp.listLoadFail", { status: String(res.status) }));
        return;
      }
      setList(Array.isArray(data.list) ? data.list : []);
    } catch (e) {
      setList([]);
      setListError(e instanceof Error ? e.message : t("mcp.networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadBuiltin();
  }, [loadBuiltin]);

  const patchBuiltinMaster = async (next: boolean) => {
    if (builtinLoading || builtinSaving) return;
    setBuiltinSaving(true);
    try {
      const res = await fetch("/api/system/mcp-builtin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ builtinServicesEnabled: next }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        builtinServicesEnabled?: boolean;
        registeredBuiltinMcps?: RegisteredBuiltinMcpRow[];
      };
      if (res.ok && data.ok) {
        if (typeof data.builtinServicesEnabled === "boolean") setBuiltinServicesEnabled(data.builtinServicesEnabled);
        if (Array.isArray(data.registeredBuiltinMcps)) setRegisteredBuiltinMcps(data.registeredBuiltinMcps);
      } else if (data.message) window.alert(data.message);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("mcp.formSaveFail"));
    } finally {
      setBuiltinSaving(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setTestHint(null);
    setModalOpen(true);
  };

  const openEdit = (s: McpServicePublic) => {
    setEditingId(s.id);
    setForm(serviceToForm(s));
    setFormError(null);
    setTestHint(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSubmitting(false);
    setFormError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    const body = {
      name: form.name.trim(),
      transport: form.transport,
      definition: buildDefinition(form),
    };
    try {
      const url = editingId ? `/api/system/mcp-services/${encodeURIComponent(editingId)}` : "/api/system/mcp-services";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setFormError(data.message || t("mcp.formSaveFail"));
        return;
      }
      closeModal();
      await loadList();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("mcp.formSaveFail"));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRowEnabled = async (s: McpServicePublic) => {
    try {
      const res = await fetch(`/api/system/mcp-services/${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        window.alert(data.message || t("mcp.updateEnableFail"));
        return;
      }
      await loadList();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("mcp.updateFail"));
    }
  };

  const exportMcpJson = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/system/mcp-services/export");
      const data = (await res.json()) as {
        ok?: boolean;
        mcpServers?: Record<string, unknown>;
        message?: string;
        datasourceMcpMerged?: boolean;
        mineruLocalMcpMerged?: boolean;
        mineruApiMcpMerged?: boolean;
      };
      if (!res.ok || !data.ok) {
        window.alert(data.message || t("mcp.exportFail"));
        return;
      }
      const text = JSON.stringify({ mcpServers: data.mcpServers ?? {} }, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        window.alert(t("mcp.exportClipboardOk"));
      } catch {
        window.alert(text);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("mcp.exportFail"));
    } finally {
      setExporting(false);
    }
  };

  const remove = async (s: McpServicePublic) => {
    if (!window.confirm(t("mcp.deleteConfirm", { name: s.name }))) return;
    try {
      const res = await fetch(`/api/system/mcp-services/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        window.alert(data.message || t("mcp.deleteFail"));
        return;
      }
      await loadList();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("mcp.deleteFail"));
    }
  };

  const runReachability = async () => {
    if (form.transport !== "sse" && form.transport !== "streamable_http") return;
    const url = form.url.trim();
    if (!url) {
      setTestHint(t("mcp.fillUrlFirst"));
      return;
    }
    setTesting(true);
    setTestHint(null);
    try {
      const res = await fetch("/api/system/mcp-services/reachability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok?: boolean; reachable?: boolean; message?: string; status?: number };
      if (data.reachable) setTestHint(data.message || t("mcp.probeOk"));
      else setTestHint(data.message || t("mcp.probeFail"));
    } catch (e) {
      setTestHint(e instanceof Error ? e.message : t("mcp.probeError"));
    } finally {
      setTesting(false);
    }
  };

  const transportOptions = useMemo(
    () =>
      MCP_TRANSPORTS.map((transport) => (
        <option key={transport} value={transport}>
          {TRANSPORT_LABEL[transport]}
        </option>
      )),
    [],
  );

  const mcpInventoryRows = useMemo(() => {
    const builtin = registeredBuiltinMcps.map((r, i) => ({
      key: `b-${i}-${r.kind}-${r.name}`,
      name:
        r.kind === "platformCapabilities"
          ? t("mcp.builtinInventory.platformCapabilities.name")
          : r.name,
      purpose: t(`mcp.builtinInventory.${r.kind}.purpose`),
      source: "builtin" as const,
    }));
    const custom = list
      .filter((s) => s.enabled)
      .map((s) => ({
        key: `c-${s.id}`,
        name: s.name,
        purpose: purposeForCustomService(s, t),
        source: "custom" as const,
      }));
    return [...builtin, ...custom];
  }, [list, registeredBuiltinMcps, t]);

  const labelCls = "text-sm font-semibold text-slate-900 dark:text-slate-100";
  const hintCls = "mt-0.5 text-xs text-slate-500 dark:text-slate-400";

  return (
    <div className="space-y-0 text-slate-900 dark:text-slate-100">
      <h4 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{t("mcp.customTitle")}</h4>

      <div className="mt-3 space-y-3">
        {listError ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{listError}</div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("mcp.serverLabel")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("mcp.customDesc")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              disabled={exporting || Boolean(listError)}
              onClick={() => void exportMcpJson()}
              className="btn-outline inline-flex items-center justify-center gap-1.5 px-3 py-2 disabled:opacity-50"
              title={t("mcp.exportJsonTitle")}
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4 shrink-0" strokeWidth={2} />}
              {t("mcp.exportJson")}
            </button>
            <button
              type="button"
              onClick={openAdd}
              className="btn-outline inline-flex items-center justify-center gap-1.5 px-4 py-2"
            >
              <Plus className="size-4 shrink-0" strokeWidth={2} />
              {t("mcp.add")}
            </button>
          </div>
        </div>

        {list.length > 0 || loading ? (
          <div className="mt-3 border-t border-slate-200/90 pt-2.5 dark:border-slate-800">
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="size-3.5 animate-spin" />
                {t("mcp.loadList")}
              </div>
            ) : (
              <ul className="space-y-2">
                {list.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900/90"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {TRANSPORT_LABEL[s.transport]}
                        </span>
                        {!s.enabled ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                            {t("mcp.disabled")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400" title={summaryLine(s, t)}>
                        {summaryLine(s, t)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.enabled}
                        title={s.enabled ? t("mcp.clickDisable") : t("mcp.clickEnable")}
                        onClick={() => void toggleRowEnabled(s)}
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 ${
                          s.enabled ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-slate-200 dark:border-slate-500 dark:bg-slate-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
                            s.enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                          aria-hidden
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        className="btn-outline !rounded-lg px-2.5 py-1 text-[11px]"
                      >
                        {t("mcp.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(s)}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-200 dark:hover:bg-red-950/55"
                      >
                        {t("mcp.delete")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <hr className="my-3 border-0 border-t border-slate-200 dark:border-slate-800" />

      <h4 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{t("mcp.builtinTitle")}</h4>
      <div className="mt-2 rounded-lg border border-slate-200/80 bg-white/90 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/90">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("mcp.builtinName")}</span>
              {builtinConnected ? (
                <span className="rounded-md bg-emerald-500 px-2 py-0.5 text-[11px] font-medium leading-none text-white">
                  {t("mcp.builtinOn")}
                </span>
              ) : (
                <span className="rounded-md bg-slate-300 px-2 py-0.5 text-[11px] font-medium leading-none text-white">
                  {t("mcp.builtinOff")}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{t("mcp.builtinDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={builtinServicesEnabled}
            disabled={builtinLoading || builtinSaving || !builtinConnected}
            onClick={() => void patchBuiltinMaster(!builtinServicesEnabled)}
            title={
              builtinConnected
                ? builtinServicesEnabled
                  ? t("mcp.builtinToggleOn")
                  : t("mcp.builtinToggleOff")
                : t("mcp.builtinNeedDb")
            }
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-not-allowed disabled:opacity-50 ${
              builtinServicesEnabled ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-slate-200 dark:border-slate-500 dark:bg-slate-600"
            }`}
          >
            <span
              className={`pointer-events-none absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
                builtinServicesEnabled ? "translate-x-5" : "translate-x-0"
              }`}
              aria-hidden
            />
          </button>
        </div>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200/80 bg-white/90 dark:border-slate-700 dark:bg-slate-900/90">
        {mcpInventoryRows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">{t("mcp.emptyInventory")}</div>
        ) : (
          <table className="min-w-[480px] w-full border-collapse text-left text-[12px] text-slate-800 dark:text-slate-200">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-800/90">
                <th className="px-3 py-2.5 font-semibold">{t("mcp.colName")}</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold">{t("mcp.colSource")}</th>
                <th className="px-3 py-2.5 font-semibold">{t("mcp.colPurpose")}</th>
              </tr>
            </thead>
            <tbody>
              {mcpInventoryRows.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800">
                  <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-400">
                    {r.source === "builtin" ? t("mcp.source.builtin") : t("mcp.sourceCustom")}
                  </td>
                  <td className="px-3 py-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{r.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-3 sm:items-center">
          <div
            className="mcp-service-modal flex max-h-[92vh] w-full max-w-[562px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-modal-title"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h2 id="mcp-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? t("mcp.modalEdit") : t("mcp.modalAdd")}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="mcp-modal-icon"
                title={t("mcp.close")}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {formError ? <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</div> : null}

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-6 sm:gap-10">
                    <div className="w-[7.5rem] shrink-0 sm:w-32">
                      <label className={`${labelCls} block`}>{t("mcp.fieldType")}</label>
                      <p className="mt-1 block text-xs leading-snug text-slate-500">{t("mcp.fieldTypeHint")}</p>
                    </div>
                    <select
                      className="mcp-modal-type-select"
                      value={form.transport}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, transport: e.target.value as McpTransport }))
                      }
                    >
                      {transportOptions}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>{t("mcp.fieldName")}</label>
                  <input
                    placeholder="my-mcp-server"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>

                {form.transport === "stdio" ? (
                  <>
                    <div>
                      <label className={labelCls}>{t("mcp.fieldCommand")}</label>
                      <input
                        placeholder="npx -y @modelcontextprotocol/server-filesystem"
                        value={form.command}
                        onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("mcp.fieldArgs")}</label>
                      <input
                        placeholder={t("mcp.fieldArgsPlaceholder")}
                        value={form.argsText}
                        onChange={(e) => setForm((f) => ({ ...f, argsText: e.target.value }))}
                      />
                      <p className={hintCls}>{t("mcp.fieldArgsHint")}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{t("mcp.fieldEnv")}</label>
                      <div className="mt-2 space-y-2">
                        {form.envRows.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              className="mcp-modal-input-row"
                              placeholder="KEY"
                              value={row.key}
                              onChange={(e) =>
                                setForm((f) => {
                                  const envRows = [...f.envRows];
                                  envRows[idx] = { ...envRows[idx], key: e.target.value };
                                  return { ...f, envRows };
                                })
                              }
                            />
                            <span className="text-slate-400">=</span>
                            <input
                              className="mcp-modal-input-row"
                              placeholder="value"
                              value={row.value}
                              onChange={(e) =>
                                setForm((f) => {
                                  const envRows = [...f.envRows];
                                  envRows[idx] = { ...envRows[idx], value: e.target.value };
                                  return { ...f, envRows };
                                })
                              }
                            />
                            <button
                              type="button"
                              title={t("mcp.delete")}
                              className="mcp-modal-icon-danger"
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  envRows: f.envRows.length > 1 ? f.envRows.filter((_, i) => i !== idx) : [{ key: "", value: "" }],
                                }))
                              }
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, envRows: [...f.envRows, { key: "", value: "" }] }))}
                          className="mcp-modal-add-row"
                        >
                          {t("mcp.envAdd")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                {form.transport === "sse" || form.transport === "streamable_http" ? (
                  <>
                    <div>
                      <label className={labelCls}>{t("mcp.fieldUrl")}</label>
                      <input
                        placeholder="https://example.com/mcp/sse"
                        value={form.url}
                        onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("mcp.fieldHeaders")}</label>
                      <div className="mt-2 space-y-2">
                        {form.headerRows.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              className="mcp-modal-input-row"
                              placeholder={t("mcp.headerName")}
                              value={row.key}
                              onChange={(e) =>
                                setForm((f) => {
                                  const headerRows = [...f.headerRows];
                                  headerRows[idx] = { ...headerRows[idx], key: e.target.value };
                                  return { ...f, headerRows };
                                })
                              }
                            />
                            <span className="text-slate-400">:</span>
                            <input
                              className="mcp-modal-input-row"
                              placeholder={t("mcp.headerValue")}
                              value={row.value}
                              onChange={(e) =>
                                setForm((f) => {
                                  const headerRows = [...f.headerRows];
                                  headerRows[idx] = { ...headerRows[idx], value: e.target.value };
                                  return { ...f, headerRows };
                                })
                              }
                            />
                            <button
                              type="button"
                              title={t("mcp.delete")}
                              className="mcp-modal-icon-danger"
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  headerRows:
                                    f.headerRows.length > 1
                                      ? f.headerRows.filter((_, i) => i !== idx)
                                      : [{ key: "", value: "" }],
                                }))
                              }
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setForm((f) => ({ ...f, headerRows: [...f.headerRows, { key: "", value: "" }] }))
                          }
                          className="mcp-modal-add-row"
                        >
                          {t("mcp.envAdd")}
                        </button>
                      </div>
                      <p className={hintCls}>{t("mcp.headerHint")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={testing}
                        onClick={() => void runReachability()}
                        className="mcp-modal-outline !px-3 !py-1.5 text-xs disabled:opacity-50"
                      >
                        {testing ? t("mcp.testingReach") : t("mcp.testReach")}
                      </button>
                      {testHint ? <span className="text-xs text-slate-600">{testHint}</span> : null}
                    </div>
                  </>
                ) : null}

                {form.transport === "json" ? (
                  <div>
                    <label className={labelCls}>{t("mcp.jsonField")}</label>
                    <textarea
                      className="min-h-[220px] font-mono text-xs leading-relaxed"
                      value={form.jsonText}
                      onChange={(e) => setForm((f) => ({ ...f, jsonText: e.target.value }))}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
              <button
                type="button"
                onClick={closeModal}
                className="mcp-modal-outline"
              >
                {t("mcp.cancel")}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="mcp-modal-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {editingId ? t("mcp.confirmSave") : t("mcp.confirmAdd")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
