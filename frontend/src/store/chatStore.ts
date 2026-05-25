"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getDataScopeUserId, scopedLocalStorageKey } from "@/lib/client-data-scope";
import { SUPER_ADMIN_USER_ID } from "@/lib/platform-auth";

/** 分桶前 Zustand persist 使用的全局键；仅用于一次性迁出，避免升级后历史会话「消失」 */
const LEGACY_CHAT_STORE_PERSIST_KEY = "chat-store-v1";
import { ChatMessage, ContentBlock, type DatasourceDraftUiState } from "@/components/chat/types";
import type { DataSourceStoredConfig } from "@/components/data/types";
import { datasourceDraftFingerprint } from "@/lib/datasource-draft-state";
import { streamChatTurn } from "@/store/chatOrchestrator";
import { humanizeHermesProcessMessage, humanizeHermesToolName } from "@/lib/chat-process-labels";
import { resolveBaodanBillNosFromConversation } from "@/lib/baodan-bill-no-parse";
import { computeAssistantViewMarkdownForCompletedTurn } from "@/lib/assistant-view-surface";
import {
  appendNarrativeDelta,
  appendStepToTimeline,
  collapseProcessTimelineToolSteps,
  dedupeToolStepsByTraceId,
} from "@/lib/process-timeline";
import { CHAT_MODEL_AUTO_SENTINEL, resolveChatTurnModelConfig } from "@/lib/chat-turn-model-config";
import { clampStepLogFields } from "@/lib/process-payload-limit";

export type ModelConfig = {
  id: string;
  modelName: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  temp: number;
  maxTokens: number;
  syncStatus?: "synced" | "pending" | "failed";
  available?: boolean;
};

type HistorySession = {
  id: string;
  title: string;
  createdAt: string;
  href: string;
};

type ChatState = {
  messages: ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  isLoading: boolean;
  loadingBySessionId: Record<string, boolean>;
  connectionStatus: "idle" | "connecting" | "streaming" | "completed" | "failed";
  runtimeInfo: {
    upstreamMode: "hermes" | "model-direct" | "unknown";
    traceId?: string;
    firstTokenLatencyMs?: number;
    lastError?: string;
    retryableError?: boolean;
  };
  contextHint: string;
  currentSessionId: string | null;
  historySessions: HistorySession[];
  modelConfigs: ModelConfig[];
  /** 新任务/会话输入框当前选中的模型（`自动` 或已保存的 modelName） */
  selectedChatModel: string;
  setSelectedChatModel: (model: string) => void;
  /** 为 true 时在请求中附带 context，BFF 注入数据源向导系统提示，仍走 Hermes / 直连模型 */
  datasourceWizardActive: boolean;
  setDatasourceWizardActive: (v: boolean) => void;
  /** 为 true 时在请求中附带 context，BFF 注入「数据规则审核助手」系统提示 */
  dataRuleAuditWizardActive: boolean;
  setDataRuleAuditWizardActive: (v: boolean) => void;
  /** 追问标签等：写入底部输入框（不直接发消息）；`nonce` 供 ChatInput 区分重复点击 */
  composerInsertRequest: { text: string; nonce: number } | null;
  requestComposerInsertText: (text: string) => void;
  clearComposerInsertRequest: () => void;
  openSession: (id: string) => void;
  enterNewTaskWorkspace: () => void;
  renameHistorySession: (id: string, title: string) => void;
  deleteHistorySession: (id: string) => void;
  addModelConfig: (config: ModelConfig) => void;
  updateModelConfig: (id: string, patch: Omit<ModelConfig, "id">) => void;
  deleteModelConfig: (id: string) => void;
  sendMessage: (input: {
    text: string;
    blocks: ContentBlock[];
    model?: string;
    /** 丢弃该助手消息及其后的记录，并基于其前一条用户消息重新流式生成（不新增用户气泡） */
    replaceAssistantId?: string;
  }) => Promise<string>;
  retryLatestTurn: () => Promise<void>;
  registerSkill: (input: {
    name: string;
    description: string;
    scene: string;
  }) => Promise<{ ok: boolean; skillId?: string }>;
  /** 将数据源草稿卡进度写回当前会话消息（localStorage 持久化） */
  patchDatasourceDraftCard: (
    recordId: string,
    patch: {
      draft?: Partial<DatasourceDraftUiState>;
      recordConfigPatch?: Partial<DataSourceStoredConfig>;
    },
  ) => void;
};

type StepLogEvent = NonNullable<ChatMessage["stepLogs"]>[number];

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function now() {
  return new Date().toISOString();
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const sec = Math.max(1, Math.round((end - start) / 1000));
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return min > 0 ? `${min}分${rest}秒` : `${rest}秒`;
}

function normalizeMessageText(input?: string) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function isLowSignalText(text: string) {
  if (!text) return true;
  if (/^(已获得阶段思考信息|阶段.+更新|该步骤已执行。?)$/.test(text)) return true;
  if (/^[。！？,.!?\s]+$/.test(text)) return true;
  return false;
}

function toReadableStepLine(log: StepLogEvent) {
  const rawDetail = normalizeMessageText(log.message);
  const detail = humanizeHermesProcessMessage(rawDetail);
  if (detail.length > 220) {
    return "";
  }
  if (isLowSignalText(rawDetail)) {
    if (log.kind === "tool" || log.toolName) {
      const label = humanizeHermesToolName((log.toolName || log.step || "工具").trim());
      return `我正在处理：${label}。`;
    }
    return "";
  }
  if (log.kind === "tool" || log.toolName) {
    const label = humanizeHermesToolName((log.toolName || log.step || "工具").trim());
    return `我调用了「${label}」，${detail}`;
  }
  return humanizeHermesProcessMessage(rawDetail);
}

function buildProcessFromStepLogs(
  stepLogs: StepLogEvent[],
) {
  if (!stepLogs.length) {
    return {
      thinkingText: "",
      executionLogs: [],
    };
  }

  const readableLines = stepLogs
    .map((log) => toReadableStepLine(log))
    .filter(Boolean)
    .filter((line, idx, arr) => arr.findIndex((v) => v === line) === idx);
  const phaseHints = stepLogs
    .filter((log) => /(intent|analy|think|plan|reflect|理解|分析|计划|反思)/i.test(log.step))
    .map((log) => normalizeMessageText(log.message))
    .filter((line) => !isLowSignalText(line));
  const narrative = readableLines.length ? readableLines : phaseHints;
  const hasReasoning = stepLogs.some((log) => log.kind === "phase" || /(think|plan|理解|分析|计划|反思)/i.test(log.step));
  const hasToolAction = stepLogs.some((log) => log.kind === "tool" || !!log.toolName);
  const hasFailure = stepLogs.some((log) => log.status === "error");
  const preface: string[] = [];
  if (hasReasoning) preface.push("我先梳理了你的目标和约束。");
  if (hasToolAction) preface.push("然后我按计划调用了相关能力执行。");
  if (hasFailure) preface.push("当前执行中存在异常，我会给出可操作的下一步。");
  const thinkingText = [...preface, ...narrative]
    .filter(Boolean)
    .join("。")
    .replace(/。+/g, "。")
    .trim() || "我已完成本轮分析，正在整理可执行结果。";

  const executionLogs = stepLogs
    .filter((log) => log.kind === "tool" || !!log.toolName)
    .map((log) => {
      const statusText = log.status === "error" ? "Failed" : log.status === "running" ? "Running" : "Done";
      const tool = humanizeHermesToolName((log.toolName || log.step || "tool").trim());
      const detail = humanizeHermesProcessMessage(normalizeMessageText(log.message));
      return detail && !isLowSignalText(log.message)
        ? `> ${tool} … ${statusText} | ${detail}`
        : `> ${tool} … ${statusText}`;
    });

  return { thinkingText, executionLogs };
}

/** 从 Zustand persist JSON 估算「是否有实质数据」，用于在分桶后仍能从旧键恢复 */
function chatPersistRichness(raw: string | null): number {
  if (!raw?.trim()) return 0;
  try {
    const o = JSON.parse(raw) as {
      state?: {
        historySessions?: unknown[];
        sessionMessages?: Record<string, unknown>;
        modelConfigs?: unknown[];
      };
    };
    const s = o?.state;
    if (!s) return 0;
    const h = Array.isArray(s.historySessions) ? s.historySessions.length : 0;
    const m = s.sessionMessages && typeof s.sessionMessages === "object" ? Object.keys(s.sessionMessages).length : 0;
    const c = Array.isArray(s.modelConfigs) ? s.modelConfigs.length : 0;
    return h + m + c;
  } catch {
    return 0;
  }
}

const scopedChatPersistStorage = createJSONStorage(() => ({
  getItem: () => {
    if (typeof window === "undefined") return null;
    try {
      const scopedKey = scopedLocalStorageKey("chat-store-v1");
      const scoped = localStorage.getItem(scopedKey);
      const legacy = localStorage.getItem(LEGACY_CHAT_STORE_PERSIST_KEY);

      if (getDataScopeUserId() === SUPER_ADMIN_USER_ID && legacy?.trim()) {
        const sr = chatPersistRichness(scoped);
        const lr = chatPersistRichness(legacy);
        if (lr > sr) {
          localStorage.setItem(scopedKey, legacy);
          localStorage.removeItem(LEGACY_CHAT_STORE_PERSIST_KEY);
          return legacy;
        }
      }

      if (scoped != null && scoped !== "") return scoped;
      return localStorage.getItem(scopedKey);
    } catch {
      return null;
    }
  },
  setItem: (_name, value) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(scopedLocalStorageKey("chat-store-v1"), value);
    } catch {
      /* ignore */
    }
  },
  removeItem: () => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(scopedLocalStorageKey("chat-store-v1"));
    } catch {
      /* ignore */
    }
  },
}));

/**
 * useChatStore 导出常量。
 */
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      sessionMessages: {},
      isLoading: false,
      loadingBySessionId: {},
      connectionStatus: "idle",
      runtimeInfo: {
        upstreamMode: "unknown",
      },
      contextHint: "",
      currentSessionId: null,
      modelConfigs: [],
      selectedChatModel: CHAT_MODEL_AUTO_SENTINEL,
      setSelectedChatModel(model) {
        const m = (model || CHAT_MODEL_AUTO_SENTINEL).trim() || CHAT_MODEL_AUTO_SENTINEL;
        set({ selectedChatModel: m });
      },
      historySessions: [],
      datasourceWizardActive: false,
      dataRuleAuditWizardActive: false,
      composerInsertRequest: null,

      setDatasourceWizardActive(v) {
        set({ datasourceWizardActive: v });
      },

      setDataRuleAuditWizardActive(v) {
        set({ dataRuleAuditWizardActive: v });
      },

      requestComposerInsertText(text: string) {
        const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
        if (!t) return;
        set({ composerInsertRequest: { text: t, nonce: Date.now() } });
      },

      clearComposerInsertRequest() {
        set({ composerInsertRequest: null });
      },

      openSession(id) {
        const state = get();
        set({
          currentSessionId: id,
          messages: state.sessionMessages[id] ?? [],
          contextHint: "",
          composerInsertRequest: null,
          /** 切换会话视图时结束「上一页未收尾的加载态」，避免新任务/其它页发送按钮被误锁 */
          isLoading: false,
          loadingBySessionId: {},
          connectionStatus: "idle",
        });
      },

      enterNewTaskWorkspace() {
        set({
          currentSessionId: null,
          messages: [],
          contextHint: "",
          composerInsertRequest: null,
          /** 从会话返回新任务时，上一轮若未收到 turn.completed，isLoading 会滞留为 true，导致发送钮永久置灰 */
          isLoading: false,
          loadingBySessionId: {},
          connectionStatus: "idle",
          datasourceWizardActive: false,
          dataRuleAuditWizardActive: false,
          runtimeInfo: {
            upstreamMode: "unknown",
            traceId: undefined,
            firstTokenLatencyMs: undefined,
            lastError: undefined,
            retryableError: undefined,
          },
        });
      },

      renameHistorySession(id, title) {
        const nextTitle = title.trim();
        if (!nextTitle) return;
        set((state) => ({
          historySessions: state.historySessions.map((item) =>
            item.id === id ? { ...item, title: nextTitle } : item,
          ),
        }));
      },

      deleteHistorySession(id) {
        set((state) => {
          const wasCurrent = state.currentSessionId === id;
          const nextLoading = Object.fromEntries(
            Object.entries(state.loadingBySessionId).filter(([sid]) => sid !== id),
          );
          return {
            historySessions: state.historySessions.filter((item) => item.id !== id),
            currentSessionId: wasCurrent ? null : state.currentSessionId,
            messages: wasCurrent ? [] : state.messages,
            sessionMessages: Object.fromEntries(
              Object.entries(state.sessionMessages).filter(([sessionId]) => sessionId !== id),
            ),
            loadingBySessionId: nextLoading,
            isLoading: wasCurrent ? false : state.isLoading,
          };
        });
      },

      addModelConfig(config) {
        set((state) => ({
          modelConfigs: [...state.modelConfigs, config],
        }));
      },

      updateModelConfig(id, patch) {
        set((state) => ({
          modelConfigs: state.modelConfigs.map((item) => (item.id === id ? { ...item, ...patch, id } : item)),
        }));
      },

      deleteModelConfig(id) {
        set((state) => ({
          modelConfigs: state.modelConfigs.filter((item) => item.id !== id),
        }));
      },

      async sendMessage(input) {
        const { text, blocks, model, replaceAssistantId } = input;
        const state = get();
        let sessionId: string;
        let sessionDraft: ChatMessage[];

        if (replaceAssistantId) {
          if (!state.currentSessionId) return "";
          sessionId = state.currentSessionId;
          const full = state.sessionMessages[sessionId] ?? [];
          const regIdx = full.findIndex((m) => m.id === replaceAssistantId);
          if (regIdx < 0 || full[regIdx]?.role !== "assistant") return sessionId;
          const prevUser = full[regIdx - 1];
          if (!prevUser || prevUser.role !== "user") return sessionId;
          sessionDraft = full.slice(0, regIdx);
        } else {
          sessionId = state.currentSessionId ?? makeId("session");
          sessionDraft = state.sessionMessages[sessionId] ?? [];
        }

        const historySlice = replaceAssistantId ? sessionDraft.slice(0, -1) : sessionDraft;
        const conversationHistory = historySlice
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role,
            content: m.text || "",
          }))
          .filter((m) => m.content.trim().length > 0);
        const hasUserMessage = sessionDraft.some((m) => m.role === "user");
        const sessionTitle = "会话生成中...";
        const nextHistory = !hasUserMessage || !state.currentSessionId
          ? [
              {
                id: sessionId,
                title: sessionTitle,
                createdAt: now(),
                href: `/conversation/${encodeURIComponent(sessionId)}`,
              },
              ...state.historySessions,
            ]
          : state.historySessions.map((item) =>
              item.id === sessionId
                ? {
                    ...item,
                    title: item.title || sessionTitle,
                    createdAt: now(),
                    href: `/conversation/${encodeURIComponent(sessionId)}`,
                  }
                : item,
            );

        const effectiveText = replaceAssistantId
          ? (sessionDraft[sessionDraft.length - 1]?.text ?? "").trim()
          : text.trim();
        const effectiveBlocks = replaceAssistantId
          ? sessionDraft[sessionDraft.length - 1]?.blocks ?? []
          : blocks;

        if (!replaceAssistantId && !effectiveText && !(effectiveBlocks?.length ?? 0)) {
          return sessionId;
        }
        if (replaceAssistantId && !effectiveText && !(effectiveBlocks?.length ?? 0)) {
          return sessionId;
        }

        const datasourceSkillInBlocks =
          Array.isArray(effectiveBlocks) &&
          effectiveBlocks.some(
            (b) =>
              b.type === "skill_card" &&
              (String((b as { name?: string }).name ?? "").trim() === "数据源配置助手" ||
                /datasource-wizard-skill/i.test(String((b as { skillId?: string }).skillId ?? ""))),
          );
        const auditSkillInBlocks =
          Array.isArray(effectiveBlocks) &&
          effectiveBlocks.some(
            (b) =>
              b.type === "skill_card" &&
              (String((b as { name?: string }).name ?? "").trim() === "数据规则审核助手" ||
                /data-rule-audit-skill/i.test(String((b as { skillId?: string }).skillId ?? ""))),
          );
        const effectiveAuditWizard = state.dataRuleAuditWizardActive || auditSkillInBlocks;
        const effectiveDatasourceWizard =
          !effectiveAuditWizard && (state.datasourceWizardActive || datasourceSkillInBlocks);

        if (replaceAssistantId) {
          set((prev) => ({
            messages: prev.currentSessionId === sessionId ? sessionDraft : prev.messages,
            sessionMessages: {
              ...prev.sessionMessages,
              [sessionId]: sessionDraft,
            },
            isLoading: true,
            loadingBySessionId: { ...prev.loadingBySessionId, [sessionId]: true },
            connectionStatus: "connecting",
            runtimeInfo: { ...prev.runtimeInfo, lastError: undefined, retryableError: undefined },
            contextHint: `最近一次追问上下文：${effectiveText || "（含技能卡片等）"}`,
            currentSessionId: sessionId,
            historySessions: nextHistory,
            datasourceWizardActive: effectiveDatasourceWizard,
            dataRuleAuditWizardActive: effectiveAuditWizard,
          }));
        } else {
          const userMsg: ChatMessage = {
            id: makeId("msg"),
            role: "user",
            text: effectiveText,
            createdAt: now(),
            blocks: effectiveBlocks,
          };
          set((prev) => ({
            messages: [...(prev.sessionMessages[sessionId] ?? []), userMsg],
            sessionMessages: {
              ...prev.sessionMessages,
              [sessionId]: [...(prev.sessionMessages[sessionId] ?? []), userMsg],
            },
            isLoading: true,
            loadingBySessionId: { ...prev.loadingBySessionId, [sessionId]: true },
            connectionStatus: "connecting",
            runtimeInfo: { ...prev.runtimeInfo, lastError: undefined, retryableError: undefined },
            contextHint: `最近一次追问上下文：${effectiveText || "（含技能卡片等）"}`,
            currentSessionId: sessionId,
            historySessions: nextHistory,
            datasourceWizardActive: effectiveDatasourceWizard,
            dataRuleAuditWizardActive: effectiveAuditWizard,
          }));
        }

        function patchAssistant(
          assistantId: string,
          patcher: (msg: ChatMessage) => ChatMessage,
        ) {
          set((state) => {
            const sessionMsgs = state.sessionMessages[sessionId] ?? [];
            const nextSessionMsgs = sessionMsgs.map((msg) => (msg.id === assistantId ? patcher(msg) : msg));
            return {
              messages: state.currentSessionId === sessionId ? nextSessionMsgs : state.messages,
              sessionMessages: {
                ...state.sessionMessages,
                [sessionId]: nextSessionMsgs,
              },
            };
          });
        }

        void (async () => {
          const assistantId = makeId("msg");
          const startedAt = now();
          const startMs = Date.now();
          let sawFirstTextDelta = false;
          let metaHintApplied = false;
          const assistantMsg: ChatMessage = {
            id: assistantId,
            role: "assistant",
            text: "",
            createdAt: startedAt,
            cards: [],
            stepLogs: [],
            processTimeline: [],
            process: {
              turnId: makeId("turn"),
              phase: "waiting_first_chunk",
              status: "running",
              startedAt,
              thinkingText: "正在发起对话请求…",
              executionLogs: [],
            },
          };

          set((state) => ({
            messages: [...(state.sessionMessages[sessionId] ?? []), assistantMsg],
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: [...(state.sessionMessages[sessionId] ?? []), assistantMsg],
            },
          }));

          let stallWatchTimer: ReturnType<typeof setTimeout> | undefined;
          const clearStallWatch = () => {
            if (stallWatchTimer) {
              clearTimeout(stallWatchTimer);
              stallWatchTimer = undefined;
            }
          };
          const scheduleStallWatch = () => {
            clearStallWatch();
            stallWatchTimer = setTimeout(() => {
              patchAssistant(assistantId, (msg) => ({
                ...msg,
                process: msg.process
                  ? {
                      ...msg.process,
                      phase:
                        msg.process.phase === "waiting_first_chunk" || msg.process.phase === "sending"
                          ? "streaming"
                          : msg.process.phase,
                      thinkingText:
                        "Hermes 已连接但较长时间无新事件（可能在执行 MinerU 解析或多轮工具）。请继续等待；若超过 15 分钟仍无进展，可点「重新生成」并查看 Gateway 日志。",
                    }
                  : msg.process,
              }));
            }, 90_000);
          };

          try {
            let accumulatedText = "";
            let latestStepLogs: StepLogEvent[] = [];
            let responseSessionId = sessionId;
            const baodanStageBillNo = effectiveAuditWizard
              ? resolveBaodanBillNosFromConversation({
                  text: effectiveText,
                  conversationHistory,
                  maxBills: 5,
                }).join(",") || undefined
              : undefined;
            const { sawTurnCompleted } = await streamChatTurn(
              {
                sessionId,
                text: effectiveText,
                conversationHistory,
                blocks: effectiveBlocks,
                model: model || "自动",
                modelConfig: resolveChatTurnModelConfig(model, state.modelConfigs),
                context: effectiveAuditWizard
                  ? {
                      dataRuleAuditWizard: "1",
                      ...(baodanStageBillNo ? { baodanStageBillNo } : {}),
                    }
                  : effectiveDatasourceWizard
                    ? { datacenterDatasourceWizard: "db" }
                    : undefined,
              },
              (evt) => {
                const bumpProcessActivityPhase = (process: NonNullable<ChatMessage["process"]>) => {
                  if (process.phase === "waiting_first_chunk" || process.phase === "sending") {
                    return { ...process, phase: "streaming" as const };
                  }
                  return process;
                };

                if (evt.type === "meta") {
                  scheduleStallWatch();
                  responseSessionId = evt.sessionId || responseSessionId;
                  if (!metaHintApplied) {
                    metaHintApplied = true;
                    const upstreamWaitHint =
                      evt.source === "hermes"
                        ? "已连接 Hermes，等待阶段与回复…"
                        : evt.source === "model-direct"
                          ? "当前为直连模型（Hermes 流未建立或不可用），等待生成回复…"
                          : "等待上游返回…";
                    patchAssistant(assistantId, (msg) => ({
                      ...msg,
                      process: msg.process
                        ? { ...msg.process, thinkingText: upstreamWaitHint }
                        : msg.process,
                    }));
                  }
                  set((store) => ({
                    connectionStatus: "streaming",
                    runtimeInfo: {
                      ...store.runtimeInfo,
                      upstreamMode:
                        evt.source === "hermes"
                          ? "hermes"
                          : evt.source === "model-direct"
                            ? "model-direct"
                            : store.runtimeInfo.upstreamMode,
                      traceId: evt.traceId,
                    },
                  }));
                  return;
                }
                if (evt.type === "turn.heartbeat") {
                  scheduleStallWatch();
                  const hint =
                    evt.message?.trim() ||
                    "Hermes 仍在执行（可能含文档解析或多轮工具），请稍候…";
                  patchAssistant(assistantId, (msg) => ({
                    ...msg,
                    process: msg.process
                      ? {
                          ...bumpProcessActivityPhase(msg.process),
                          thinkingText: hint,
                        }
                      : msg.process,
                  }));
                  return;
                }
                if (evt.type === "text.delta") {
                  scheduleStallWatch();
                  accumulatedText += evt.delta || "";
                  if (!sawFirstTextDelta) {
                    sawFirstTextDelta = true;
                    set((store) => ({
                      runtimeInfo: {
                        ...store.runtimeInfo,
                        firstTokenLatencyMs: Date.now() - startMs,
                      },
                    }));
                  }
                  // 流式正文进入时间线叙述块，与工具事件交错，供「已完成」内按真实顺序展示。
                  patchAssistant(assistantId, (msg) => ({
                    ...msg,
                    text: accumulatedText,
                    processTimeline: appendNarrativeDelta(msg.processTimeline, evt.delta || ""),
                    process: msg.process
                      ? {
                          ...msg.process,
                          phase: "streaming",
                          thinkingText:
                            accumulatedText.trim().length > 0
                              ? "过程与工具见上方时间线；面向用户的润色结论请在下方正文（建议以「## 审核报告」「## 数据缺口预警」「## 最终结论」等标题单独成段）。"
                              : msg.process.thinkingText,
                        }
                      : msg.process,
                  }));
                  return;
                }
                let logPush: StepLogEvent | null = null;
                if (
                  evt.type === "reasoning.delta" ||
                  evt.type === "tool.started" ||
                  evt.type === "tool.completed" ||
                  evt.type === "step"
                ) {
                  scheduleStallWatch();
                }
                if (evt.type === "reasoning.delta") {
                  const phaseStep: StepLogEvent = {
                    kind: "phase",
                    step: "thinking",
                    phaseId: evt.phaseId || "understand",
                    status: "running",
                    message: evt.message || "已更新思考过程",
                    traceId: evt.traceId,
                  };
                  latestStepLogs = [...latestStepLogs, phaseStep];
                  logPush = phaseStep;
                } else if (evt.type === "tool.started" || evt.type === "tool.completed") {
                  const entry: StepLogEvent = clampStepLogFields({
                    kind: "tool",
                    step: evt.name,
                    toolName: evt.name,
                    status: evt.type === "tool.started" ? "running" : "success",
                    message: evt.detail || `${evt.name} 执行更新`,
                    latencyMs: evt.latencyMs,
                    errorCode: evt.errorCode,
                    inputPreview: evt.inputPreview,
                    outputPreview: evt.outputPreview,
                    traceId: evt.traceId,
                  });
                  latestStepLogs = [...latestStepLogs, entry];
                  logPush = entry;
                } else if (evt.type === "step") {
                  latestStepLogs = [...latestStepLogs, evt.step];
                  logPush = evt.step;
                } else if (evt.type === "turn.completed") {
                  clearStallWatch();
                  responseSessionId = evt.sessionId || responseSessionId;
                  const finalStepLogs = dedupeToolStepsByTraceId(evt.stepLogs ?? latestStepLogs);
                  latestStepLogs = finalStepLogs;
                  accumulatedText = evt.assistant?.text ?? accumulatedText;
                  const processDraft = buildProcessFromStepLogs(finalStepLogs);
                  patchAssistant(assistantId, (msg) => {
                    const collapsedTimeline = msg.processTimeline?.length
                      ? collapseProcessTimelineToolSteps(msg.processTimeline)
                      : msg.processTimeline;
                    const assistantViewMarkdown = computeAssistantViewMarkdownForCompletedTurn(
                      accumulatedText,
                      collapsedTimeline,
                    );
                    return {
                      ...msg,
                      text: accumulatedText || msg.text,
                      assistantViewMarkdown,
                      cards: evt.assistant?.cards ?? msg.cards,
                      stepLogs: finalStepLogs,
                      processTimeline: collapsedTimeline,
                      process: msg.process
                        ? {
                            ...msg.process,
                            phase: "completed",
                            status: "completed",
                            thinkingText: processDraft.thinkingText,
                            executionLogs: processDraft.executionLogs,
                          }
                        : msg.process,
                    };
                  });
                  return;
                } else if (evt.type === "turn.failed") {
                  clearStallWatch();
                  throw new Error(evt.message || "流式执行失败");
                }
                const processDraft = buildProcessFromStepLogs(latestStepLogs);
                patchAssistant(assistantId, (msg) => ({
                  ...msg,
                  stepLogs: latestStepLogs,
                  processTimeline: logPush
                    ? appendStepToTimeline(msg.processTimeline, logPush)
                    : msg.processTimeline,
                  process: msg.process
                    ? {
                        ...bumpProcessActivityPhase(msg.process),
                        thinkingText: processDraft.thinkingText,
                        executionLogs: processDraft.executionLogs,
                      }
                    : msg.process,
                }));
              },
            );

            clearStallWatch();
            const endedAt = now();

            if (!sawTurnCompleted) {
              const interruptNote =
                "【连接提前结束】未收到本回合完成信号（常见于：标签页休眠、反向代理或网关超时、Next 开发服务热更新导致 SSE 中断、或浏览器标签崩溃后恢复）。上文过程可能仍有效；请点击该条助手消息旁的「重试」继续生成最终报告，或适当减少单次任务中的解析次数后再试。";
              patchAssistant(assistantId, (msg) => ({
                ...msg,
                text: accumulatedText.trim()
                  ? `${accumulatedText.trim()}\n\n---\n\n${interruptNote}`
                  : interruptNote,
                stepLogs: [
                  ...(msg.stepLogs ?? []),
                  {
                    kind: "note",
                    step: "chat_turn",
                    status: "error",
                    message: "流结束但未收到 turn.completed",
                    phaseId: "other",
                  },
                ],
                process: msg.process
                  ? {
                      ...msg.process,
                      phase: "failed",
                      status: "failed",
                      endedAt,
                      thinkingText: interruptNote,
                      executionLogs: [
                        ...msg.process.executionLogs,
                        "> chat_turn: SSE 中断（无 turn.completed）",
                      ],
                    }
                  : msg.process,
              }));
              set((store) => ({
                isLoading: false,
                currentSessionId: responseSessionId,
                connectionStatus: "failed",
                loadingBySessionId: { ...store.loadingBySessionId, [sessionId]: false },
                runtimeInfo: {
                  ...store.runtimeInfo,
                  lastError: "SSE 结束但未收到回合完成事件",
                  retryableError: true,
                },
              }));
            } else {
              patchAssistant(assistantId, (msg) => ({
                ...msg,
                process: msg.process
                  ? {
                      ...msg.process,
                      phase: "completed",
                      status: "completed",
                      endedAt,
                      executionLogs: msg.process.executionLogs.map((line) =>
                        line.includes("Running") ? line.replace("Running", "Done") : line,
                      ),
                    }
                  : msg.process,
              }));
              set({
                isLoading: false,
                currentSessionId: responseSessionId,
                connectionStatus: "completed",
                loadingBySessionId: { ...get().loadingBySessionId, [sessionId]: false },
              });
            }
          } catch (error) {
            clearStallWatch();
            const endedAt = now();
            const reason =
              error instanceof Error ? error.message.trim() : "对话执行失败，请稍后重试。";
            const userText =
              reason.length > 1200 ? `${reason.slice(0, 1200)}…` : reason || "执行失败，请检查模型配置或网络后重试。";
            patchAssistant(assistantId, (msg) => ({
              ...msg,
              text: userText,
              stepLogs: [
                ...(msg.stepLogs ?? []),
                {
                  kind: "note",
                  step: "chat_turn",
                  status: "error",
                  message: reason || "请求失败",
                  phaseId: "other",
                },
              ],
              process: msg.process
                ? {
                    ...msg.process,
                    phase: "failed",
                    status: "failed",
                    endedAt,
                    thinkingText: reason || msg.process.thinkingText,
                    executionLogs: [
                      ...msg.process.executionLogs,
                      `> chat_turn: ${reason || "Failed"}`,
                    ],
                  }
                : msg.process,
            }));
            set((store) => ({
              isLoading: false,
              connectionStatus: "failed",
              loadingBySessionId: { ...store.loadingBySessionId, [sessionId]: false },
              runtimeInfo: {
                ...store.runtimeInfo,
                lastError: error instanceof Error ? error.message : "未知错误",
                retryableError: true,
              },
            }));
          }
        })();

        return sessionId;
      },

      async retryLatestTurn() {
        const state = get();
        const msgs = state.messages;
        const lastAssist = [...msgs].reverse().find((m) => m.role === "assistant");
        if (lastAssist) {
          await state.sendMessage({
            text: "",
            blocks: [],
            model: "自动",
            replaceAssistantId: lastAssist.id,
          });
          return;
        }
        const lastUser = [...msgs].reverse().find((m) => m.role === "user");
        if (!lastUser) return;
        if (!lastUser.text.trim() && !(lastUser.blocks?.length ?? 0)) return;
        await state.sendMessage({ text: lastUser.text, blocks: lastUser.blocks ?? [], model: "自动" });
      },

      async registerSkill(input) {
        const res = await fetch("/api/skills/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) return { ok: false };
        return res.json();
      },

      patchDatasourceDraftCard(recordId, patch) {
        const sessionId = get().currentSessionId;
        if (!sessionId) return;

        const patchMessageCards = (msgs: ChatMessage[]): ChatMessage[] => {
          let changed = false;
          const next = msgs.map((msg) => {
            if (!msg.cards?.length) return msg;
            let msgChanged = false;
            const cards = msg.cards.map((card) => {
              if (card.type !== "datasource_draft" || card.payload.record.id !== recordId) {
                return card;
              }
              msgChanged = true;
              const record = { ...card.payload.record };
              if (patch.recordConfigPatch) {
                record.config = { ...record.config, ...patch.recordConfigPatch };
              }
              const fp = datasourceDraftFingerprint(record);
              const prevDraft = card.payload.draft;
              const base: DatasourceDraftUiState = {
                configFingerprint: fp,
                ...(prevDraft?.configFingerprint === fp ? prevDraft : {}),
              };
              const draft: DatasourceDraftUiState = {
                ...base,
                ...patch.draft,
                configFingerprint: fp,
              };
              return {
                ...card,
                payload: { record, draft },
              };
            });
            if (!msgChanged) return msg;
            changed = true;
            return { ...msg, cards };
          });
          return changed ? next : msgs;
        };

        set((state) => {
          const sessionMsgs = state.sessionMessages[sessionId] ?? [];
          const patched = patchMessageCards(sessionMsgs);
          if (patched === sessionMsgs) return state;
          const sessionMessages = { ...state.sessionMessages, [sessionId]: patched };
          const messages =
            state.currentSessionId === sessionId ? patched : state.messages;
          return { sessionMessages, messages };
        });
      },
    }),
    {
      name: "chat-store-v1",
      storage: scopedChatPersistStorage,
      partialize: (state) => ({
        historySessions: state.historySessions,
        currentSessionId: state.currentSessionId,
        modelConfigs: state.modelConfigs,
        selectedChatModel: state.selectedChatModel,
        sessionMessages: state.sessionMessages,
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<ChatState>;
        return {
          ...current,
          ...persistedState,
          historySessions: persistedState.historySessions ?? current.historySessions,
          sessionMessages: persistedState.sessionMessages ?? current.sessionMessages,
        };
      },
    },
  ),
);

/** 切换登录用户后调用，从当前分桶的 localStorage 重新灌入 Zustand */
export async function rehydrateChatStoreForDataScope() {
  await useChatStore.persist.rehydrate();
}

export { formatDuration };

