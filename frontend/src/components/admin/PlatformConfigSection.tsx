"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ModelConfig, useChatStore } from "@/store/chatStore";

const modelProviders = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Meta",
  "Mistral",
  "Cohere",
  "xAI",
  "Amazon Bedrock",
  "Azure OpenAI",
  "阿里云百炼（通义）",
  "百度智能云千帆（文心）",
  "火山引擎（豆包）",
  "腾讯混元",
  "智谱 AI（GLM）",
  "月之暗面（Kimi）",
  "DeepSeek",
  "MiniMax",
  "零一万物（Yi）",
  "科大讯飞（星火）",
];

/**
 * PlatformConfigSection 组件/函数。
 */
export function PlatformConfigSection({ mode = "all" }: { mode?: "all" | "model" }) {
  const { t } = useI18n();
  const [showModelForm, setShowModelForm] = useState(false);
  const [provider, setProvider] = useState("OpenAI");
  const [apiKey, setApiKey] = useState("");
  const [temp, setTemp] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [modelName, setModelName] = useState("gpt-4o");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const savedModels = useChatStore((s) => s.modelConfigs);
  const addModelConfig = useChatStore((s) => s.addModelConfig);
  const updateModelConfig = useChatStore((s) => s.updateModelConfig);
  const removeModelConfig = useChatStore((s) => s.deleteModelConfig);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingModelForm, setEditingModelForm] = useState<ModelConfig | null>(null);
  const [testingCreate, setTestingCreate] = useState(false);
  const [testingEditId, setTestingEditId] = useState<string | null>(null);
  const [testingSavedId, setTestingSavedId] = useState<string | null>(null);
  const [toastText, setToastText] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const showModel = mode === "all" || mode === "model";
  const sectionClassName = mode === "model" ? "" : "task-card";
  const showToast = (message: string) => {
    setToastText(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1000);
  };
  const showSaveToast = () => {
    showToast(t("model.toastSaved"));
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/system/models");
        const data = (await res.json()) as { list?: ModelConfig[] };
        if (!active || !Array.isArray(data.list)) return;
        const localIds = new Set(savedModels.map((item) => item.id));
        data.list.forEach((item) => {
          if (!localIds.has(item.id)) addModelConfig({ ...item, syncStatus: item.syncStatus ?? "synced" });
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [addModelConfig, savedModels]);
  const testModelConnection = async (config: Pick<ModelConfig, "provider" | "modelName" | "baseUrl" | "apiKey">) => {
    const response = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const result = await response.json();
    return result as { ok: boolean; message?: string };
  };

  return (
    <section className={`${sectionClassName} text-slate-900 dark:text-slate-100`}>
      {mode !== "model" ? <h3 className="dark:text-slate-100">{t("model.platformTitle")}</h3> : null}

      {showModel ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t("model.addTitle")}</p>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t("model.addSubtitle")}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModelForm((v) => !v)}
                className="!flex items-center gap-1.5 !rounded-xl border border-slate-300 !bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:!bg-slate-50 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-100 dark:hover:!bg-slate-700"
              >
                {showModelForm ? <Minus className="size-4" /> : <Plus className="size-4" />}
                <span>{showModelForm ? t("model.collapse") : t("model.add")}</span>
              </button>
            </div>

            {showModelForm ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="grid grid-cols-1 gap-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("model.fieldName")}
                    <input value={modelName} onChange={(e) => setModelName(e.target.value)} />
                  </label>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("model.fieldProvider")}
                    <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                      {modelProviders.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("model.fieldBaseUrl")}
                    <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                  </label>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("model.fieldApiKey")}
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                  </label>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("model.fieldTemp")}
                    <input type="number" step={0.1} value={temp} onChange={(e) => setTemp(Number(e.target.value))} />
                  </label>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("model.fieldMaxTokens")}
                    <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
                  </label>
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testingCreate}
                    className="!rounded-xl !bg-slate-100 px-4 py-2 text-sm !text-slate-700 hover:!bg-slate-200 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700"
                    onClick={async () => {
                      setTestingCreate(true);
                      try {
                        const result = await testModelConnection({ provider, modelName, baseUrl, apiKey });
                        showToast(result.ok ? t("model.toastTestOk") : result.message || t("model.toastTestFail"));
                      } finally {
                        setTestingCreate(false);
                      }
                    }}
                  >
                    {testingCreate ? t("model.testing") : t("model.testConnection")}
                  </button>
                  <button
                    type="button"
                    className="!rounded-xl px-4 py-2 text-sm"
                    onClick={async () => {
                      const modelConfig: ModelConfig = {
                        id: `${provider}-${modelName}-${Date.now()}`,
                        modelName,
                        provider,
                        baseUrl,
                        apiKey,
                        temp,
                        maxTokens,
                        syncStatus: "pending",
                        available: true,
                      };
                      const syncRes = await fetch("/api/system/models", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ model: modelConfig }),
                      });
                      addModelConfig({ ...modelConfig, syncStatus: syncRes.ok ? "synced" : "failed" });
                      setShowModelForm(false);
                      showToast(syncRes.ok ? t("model.toastSaveSyncOk") : t("model.toastSaveSyncPartial"));
                    }}
                  >
                    {t("model.saveConfig")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">{t("model.savedList")}</p>
            {savedModels.length ? (
              <div className="space-y-2">
                {savedModels.map((model) => (
                  <div key={model.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-600 dark:bg-slate-800/80">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-sm text-slate-700 dark:text-slate-200">
                          {model.provider} / {model.modelName}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                            model.syncStatus === "failed"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
                              : model.syncStatus === "pending"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
                          }`}
                        >
                          {model.syncStatus === "failed"
                            ? t("model.syncFailed")
                            : model.syncStatus === "pending"
                              ? t("model.syncPending")
                              : t("model.synced")}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={testingSavedId === model.id}
                          className="!rounded-lg !bg-sky-50 px-3 py-1 text-xs !text-sky-800 hover:!bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:!bg-sky-950/45 dark:!text-sky-100 dark:hover:!bg-sky-950/65"
                          onClick={async () => {
                            setTestingSavedId(model.id);
                            try {
                              const result = await testModelConnection({
                                provider: model.provider,
                                modelName: model.modelName,
                                baseUrl: model.baseUrl,
                                apiKey: model.apiKey,
                              });
                              showToast(result.ok ? t("model.toastTestOk") : result.message || t("model.toastTestFail"));
                            } finally {
                              setTestingSavedId(null);
                            }
                          }}
                        >
                          {testingSavedId === model.id ? t("model.testing") : t("model.testConnection")}
                        </button>
                        <button
                          type="button"
                          className="!rounded-lg !bg-rose-50 px-3 py-1 text-xs !text-rose-700 hover:!bg-rose-100 dark:!bg-rose-950/45 dark:!text-rose-200 dark:hover:!bg-rose-950/65"
                          onClick={async () => {
                            await fetch("/api/system/models", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: model.id }),
                            });
                            removeModelConfig(model.id);
                            if (editingModelId === model.id) {
                              setEditingModelId(null);
                              setEditingModelForm(null);
                            }
                          }}
                        >
                          {t("model.delete")}
                        </button>
                        <button
                          type="button"
                          className="!rounded-lg !bg-slate-100 px-3 py-1 text-xs !text-slate-700 hover:!bg-slate-200 dark:!bg-slate-700 dark:!text-slate-200 dark:hover:!bg-slate-600"
                          onClick={() => {
                            if (editingModelId === model.id) {
                              setEditingModelId(null);
                              setEditingModelForm(null);
                              return;
                            }
                            setEditingModelId(model.id);
                            setEditingModelForm({ ...model });
                          }}
                        >
                          {editingModelId === model.id ? t("model.collapse") : t("model.edit")}
                        </button>
                      </div>
                    </div>

                    {editingModelId === model.id && editingModelForm ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
                        <div className="grid grid-cols-1 gap-3">
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {t("model.fieldName")}
                            <input
                              value={editingModelForm.modelName}
                              onChange={(e) =>
                                setEditingModelForm((prev) => (prev ? { ...prev, modelName: e.target.value } : prev))
                              }
                            />
                          </label>
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {t("model.fieldProvider")}
                            <select
                              value={editingModelForm.provider}
                              onChange={(e) =>
                                setEditingModelForm((prev) => (prev ? { ...prev, provider: e.target.value } : prev))
                              }
                            >
                              {modelProviders.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {t("model.fieldBaseUrl")}
                            <input
                              value={editingModelForm.baseUrl}
                              onChange={(e) =>
                                setEditingModelForm((prev) => (prev ? { ...prev, baseUrl: e.target.value } : prev))
                              }
                            />
                          </label>
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {t("model.fieldApiKey")}
                            <input
                              type="password"
                              value={editingModelForm.apiKey}
                              onChange={(e) =>
                                setEditingModelForm((prev) => (prev ? { ...prev, apiKey: e.target.value } : prev))
                              }
                            />
                          </label>
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {t("model.fieldTemp")}
                            <input
                              type="number"
                              step={0.1}
                              value={editingModelForm.temp}
                              onChange={(e) =>
                                setEditingModelForm((prev) =>
                                  prev ? { ...prev, temp: Number(e.target.value) } : prev,
                                )
                              }
                            />
                          </label>
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {t("model.fieldMaxTokens")}
                            <input
                              type="number"
                              value={editingModelForm.maxTokens}
                              onChange={(e) =>
                                setEditingModelForm((prev) =>
                                  prev ? { ...prev, maxTokens: Number(e.target.value) } : prev,
                                )
                              }
                            />
                          </label>
                        </div>
                        <div className="mt-5 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={testingEditId === model.id}
                            className="!rounded-xl !bg-slate-100 px-4 py-2 text-sm !text-slate-700 hover:!bg-slate-200 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700"
                            onClick={async () => {
                              if (!editingModelForm) return;
                              setTestingEditId(model.id);
                              try {
                                const result = await testModelConnection({
                                  provider: editingModelForm.provider,
                                  modelName: editingModelForm.modelName,
                                  baseUrl: editingModelForm.baseUrl,
                                  apiKey: editingModelForm.apiKey,
                                });
                                showToast(result.ok ? t("model.toastTestOk") : result.message || t("model.toastTestFail"));
                              } finally {
                                setTestingEditId(null);
                              }
                            }}
                          >
                            {testingEditId === model.id ? t("model.testing") : t("model.testConnection")}
                          </button>
                          <button
                            type="button"
                            className="!rounded-xl px-4 py-2 text-sm"
                            onClick={async () => {
                              if (!editingModelForm) return;
                              await fetch("/api/system/models", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ model: editingModelForm }),
                              });
                              updateModelConfig(model.id, {
                                modelName: editingModelForm.modelName,
                                provider: editingModelForm.provider,
                                baseUrl: editingModelForm.baseUrl,
                                apiKey: editingModelForm.apiKey,
                                temp: editingModelForm.temp,
                                maxTokens: editingModelForm.maxTokens,
                                syncStatus: "synced",
                                available: true,
                              });
                              setEditingModelId(null);
                              setEditingModelForm(null);
                              showSaveToast();
                            }}
                          >
                            {t("model.saveConfig")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t("model.emptySaved")}</p>
            )}
          </div>
        </>
      ) : null}

      <div
        className={`pointer-events-none fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-slate-900/85 px-4 py-2 text-sm text-white transition-opacity duration-300 ${
          toastVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {toastText || t("model.toastSaved")}
      </div>
    </section>
  );
}

