"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/store/chatStore";
import { AdaptiveCardRenderer } from "@/components/chat/AdaptiveCardRenderer";
import {
  Check,
  ChevronRight,
  Copy,
  FileText,
  List,
  Loader2,
  RotateCw,
  Settings2,
  Sparkles,
  Terminal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { ChatMessage, ContentBlock } from "@/components/chat/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDuration } from "@/store/chatStore";
import { humanizeHermesProcessMessage, humanizeHermesToolName } from "@/lib/chat-process-labels";
import { collapseWs, summarizeJsonBlobForPill, tryItemCountSuffix } from "@/lib/process-step-heuristic";
import { normalizeSkillCreatorDisplayName } from "@/lib/skill-creator-display";
import { useI18n } from "@/i18n/I18nProvider";
import { displaySkillNameFromBlock } from "@/lib/skill-builtin-i18n";
import { splitAssistantProcessAndResult } from "@/lib/assistant-result-split";
import {
  ASSISTANT_MARKDOWN_BODY_CLASS,
  normalizeMarkdownForRemark,
} from "@/lib/markdown-display-normalize";
import { buildAssistantFollowUpChips, userMessagePlainHint } from "@/lib/assistant-follow-up-chips";
import {
  assistantProcessHasToolSteps,
  dedupeToolStepsByTraceId,
  flattenTimelineForProcessArea,
  stripDisclosedProcessNarrativePrefix,
} from "@/lib/process-timeline";
import { UI_JSON_PRETTIFY_MAX } from "@/lib/process-payload-limit";

type StepLog = NonNullable<ChatMessage["stepLogs"]>[number];

type ProcessActionItem = {
  id: string;
  label: string;
  status: string;
  detail: string;
  kind?: StepLog["kind"];
  toolName?: string;
  /** 工具步骤：消息里 JSON 前的说明句，展示在 pill 上方（白底正文） */
  proseAbovePill?: string;
  latencyMs?: number;
  errorCode?: string;
  inputPreview?: string;
  outputPreview?: string;
  traceId?: string;
};

function isCallIdStep(step: string | undefined) {
  return /^call_[a-z0-9]+$/i.test((step ?? "").trim());
}

function compactRedundantToolNarrative(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  return t.replace(
    /^(我调用了「[^」]+」)\s*[，,]\s*我开始调用工具「[^」]+」\s*[，,]\s*/u,
    "$1，",
  );
}

/** LLM 润色偶发把原文 JSON 再输出一遍，不能让它盖住已解析好的启发式摘要 */
function looksLikeRawJsonStepSummary(s: string): boolean {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 28) return false;
  if (/^\[\s*\{/.test(t)) return true;
  if (/^\{\s*"type"\s*:\s*"(?:input_text|output_text)"/i.test(t)) return true;
  return /"type"\s*:\s*"input_text"|"type"\s*:\s*"output_text"/i.test(t) && /"text"\s*:\s*"/.test(t);
}

function decodeEscapedUnicode(text?: string) {
  if (!text) return "";
  const normalized = text.trim();
  if (!normalized) return "";
  if (!/\\u[0-9a-fA-F]{4}/.test(normalized)) return normalized;
  try {
    return JSON.parse(`"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  } catch {
    return normalized;
  }
}

function normalizeReadableText(text?: string) {
  const decoded = decodeEscapedUnicode(text);
  return decoded.replace(/\s+/g, " ").replace(/。+/g, "。").trim();
}

/** 原始消息里首个 `{` 之前的说明句，用于「说明在 pill 上方」布局 */
function extractProseBeforeJson(raw: string): string | null {
  const s = raw.trim();
  const i = s.indexOf("{");
  if (i <= 0) return null;
  const prose = s.slice(0, i).replace(/\s+$/u, "").trim();
  return prose.length >= 4 ? prose : null;
}

/** `kind: phase` 时首行作粗体标题，其余为正文（白底、无卡片框） */
function splitPhaseHeadingBody(detail: string): { heading: string; body: string | null } {
  const t = detail.trim();
  if (!t) return { heading: "阶段", body: null };
  const lines = t.split(/\n+/u).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return { heading: lines[0] ?? "阶段", body: null };
  return { heading: lines[0]!, body: lines.slice(1).join("\n") };
}

function processStepLeadingIcon(item: ProcessActionItem) {
  const iconCls = "size-4 shrink-0 text-gray-600 dark:text-slate-400";
  const fileCls = "size-4 shrink-0 text-gray-500 dark:text-slate-500";
  if (item.kind === "phase") {
    return <Sparkles className={iconCls} aria-hidden />;
  }
  const combined = `${item.toolName ?? ""} ${item.label}`.toLowerCase();
  if (item.kind === "tool" || (item.toolName?.trim().length ?? 0) > 0) {
    if (/bash|shell|terminal|run_terminal|cmd|execute|spawn|subprocess/.test(combined)) {
      return <Terminal className={iconCls} aria-hidden />;
    }
    if (/list|glob|ls|dir|readdir|find|search_files|directory/.test(combined)) {
      return <List className={iconCls} aria-hidden />;
    }
    if (/settings|config|install|write|patch|apply|package/.test(combined)) {
      return <Settings2 className={iconCls} aria-hidden />;
    }
    return <Terminal className={iconCls} aria-hidden />;
  }
  return <FileText className={fileCls} aria-hidden />;
}

/** 距底部小于此像素视为「仍在贴底」，新内容到达时继续自动滚动 */
const CHAT_STICK_BOTTOM_SLACK_PX = 120;

function isNearChatBottom(root: HTMLElement, slackPx = CHAT_STICK_BOTTOM_SLACK_PX): boolean {
  const { scrollTop, scrollHeight, clientHeight } = root;
  return scrollHeight - scrollTop - clientHeight <= slackPx;
}

/**
 * MessageList 组件/函数。
 */
function scrollChatToBottom(root: HTMLElement | null) {
  if (!root) return;
  const apply = () => {
    root.scrollTop = root.scrollHeight;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

function assistantMessageFinished(m: ChatMessage) {
  if (m.role !== "assistant") return false;
  if (!m.process) return true;
  return m.process.status === "completed" || m.process.status === "failed";
}

function assistantMessageStreaming(m: ChatMessage): boolean {
  if (m.role !== "assistant") return false;
  if (!m.process) return false;
  return m.process.status === "running" && (m.process.phase === "streaming" || !!m.text?.trim());
}

function formatUserMessageTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * 条内 Markdown：优先回合结束固化的 `assistantViewMarkdown`（**仅当 trim 后非空**；空串视为未有效固化，避免正文区空白而长报告只在过程时间线以纯文本出现）；
 * 否则：`text` 经与过程区同源的前缀剥离（`stripDisclosedProcessNarrativePrefix`）后再按锚点收窄；**不再**单独截取末次工具之后的叙述尾段。
 */
function surfaceAssistantMarkdownBody(m: ChatMessage): string {
  if (m.role !== "assistant") return m.text;
  const fullTrim = (m.text || "").trim();
  const av = m.assistantViewMarkdown;
  if (av !== undefined && av.trim().length > 0) return av;
  if (av !== undefined && av.trim().length === 0 && fullTrim.length === 0) return av;
  const stripped = stripDisclosedProcessNarrativePrefix(m.text, m.processTimeline);
  const split = splitAssistantProcessAndResult(stripped);
  if (split.usedHeadingAnchor) {
    const rm = split.resultMarkdown.trim();
    if (rm) return split.resultMarkdown;
    return stripped;
  }
  return stripped;
}

export function MessageList() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const requestComposerInsertText = useChatStore((s) => s.requestComposerInsertText);
  const retryLatestTurn = useChatStore((s) => s.retryLatestTurn);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const contextHint = useChatStore((s) => s.contextHint);
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const runtimeInfo = useChatStore((s) => s.runtimeInfo);
  const modelConfigs = useChatStore((s) => s.modelConfigs);
  const scrollRootRef = useRef<HTMLElement | null>(null);
  /** 用户未主动上滑时为 true；上滑离开底部后暂停自动贴底，回到底部容差内再恢复 */
  const stickToBottomRef = useRef(true);
  const stepLlmRequestedRef = useRef<Set<string>>(new Set());
  const [llmStepTitles, setLlmStepTitles] = useState<Record<string, string>>({});
  const isDebugMode = process.env.NEXT_PUBLIC_CHAT_DEBUG === "true";
  const [copyFlashId, setCopyFlashId] = useState<string | null>(null);
  /** 助手消息点赞 / 点踩（仅前端反馈态，可后续接埋点） */
  const [messageVote, setMessageVote] = useState<Record<string, "up" | "down">>({});

  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );
  const firstMessageIsUser = sorted[0]?.role === "user";

  const lastAssistantId = useMemo(() => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i]!.role === "assistant") return sorted[i]!.id;
    }
    return null;
  }, [sorted]);

  const hasRunningProcess = useMemo(
    () =>
      sorted.some(
        (m) => m.role === "assistant" && m.process && m.process.status === "running",
      ),
    [sorted],
  );

  /** 运行中阶段 `formatDuration` 依赖 `Date.now()`，需定时触发重绘才能秒级递增；tick 同时驱动贴底滚动 */
  const [runningDurationTick, setRunningDurationTick] = useState(0);
  useEffect(() => {
    if (!hasRunningProcess) return;
    const id = window.setInterval(() => setRunningDurationTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasRunningProcess]);

  /** 切换会话后恢复「始终贴底」 */
  useLayoutEffect(() => {
    stickToBottomRef.current = true;
  }, [currentSessionId]);

  /** 监听滚动：用户离开底部则取消贴底，滑回底部容差内则恢复 */
  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottomRef.current = isNearChatBottom(el);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [currentSessionId, sorted.length]);

  /** 新消息 / 流式正文 / 过程区增高 / 步骤摘要更新时：仅在为贴底态时滚到最下 */
  useLayoutEffect(() => {
    if (!sorted.length) return;
    if (!stickToBottomRef.current) return;
    scrollChatToBottom(scrollRootRef.current);
  }, [messages, isLoading, runningDurationTick, llmStepTitles, sorted.length]);

  /** Markdown 等异步增高后再尝试贴底一次 */
  useEffect(() => {
    if (!sorted.length) return;
    if (!stickToBottomRef.current) return;
    const t = window.setTimeout(() => {
      if (!stickToBottomRef.current) return;
      scrollChatToBottom(scrollRootRef.current);
    }, 150);
    return () => window.clearTimeout(t);
  }, [messages, llmStepTitles, sorted.length, isLoading]);

  useEffect(() => {
    stepLlmRequestedRef.current.clear();
    setLlmStepTitles({});
  }, [currentSessionId]);

  /** 回合结束后：凡工具类步骤（`kind===tool` 或带 `toolName`）一律请求 `process-steps-summarize` 再收敛胶囊一句（需已配置直连模型）；与启发式白名单无关。 */
  useEffect(() => {
    const cfg = modelConfigs[0];
    if (!cfg?.apiKey?.trim() || !cfg.baseUrl?.trim()) return;

    type Task = {
      key: string;
      detail: string;
      toolName?: string;
      step?: string;
      status: string;
      inputPreview?: string;
      outputPreview?: string;
    };
    const tasks: Task[] = [];

    const isToolLikeStepLog = (log: StepLog) => log.kind === "tool" || !!log.toolName?.trim();

    for (const m of sorted) {
      if (m.role !== "assistant" || !m.process) continue;
      if (m.process.status !== "completed" && m.process.status !== "failed") continue;

      const pushStepTask = (log: StepLog, idx: number) => {
        if (log.kind === "phase") return;
        if (!isToolLikeStepLog(log)) return;
        const rawMsg = log.message || "";
        const detail =
          normalizeReadableText(humanizeHermesProcessMessage(rawMsg)) || "该步骤已执行。";
        const key = `${m.id}-step-${idx}-${log.traceId ?? "noid"}`;
        if (stepLlmRequestedRef.current.has(key)) return;
        tasks.push({
          key,
          detail: detail.slice(0, 2500),
          toolName: log.toolName,
          step: log.step,
          status: log.status,
          inputPreview: log.inputPreview?.slice(0, 2000),
          outputPreview: log.outputPreview?.slice(0, 2000),
        });
      };

      if (m.processTimeline?.length) {
        const flat = flattenTimelineForProcessArea(m.processTimeline);
        flat.forEach((row, idx) => {
          if (row.kind !== "step") return;
          pushStepTask(row.log, idx);
        });
        continue;
      }

      if (!m.stepLogs?.length) continue;
      const merged = dedupeToolStepsByTraceId(m.stepLogs);
      merged.forEach((log, idx) => pushStepTask(log, idx));
    }

    if (!tasks.length) return;

    const STEPS_PER_REQUEST = 12;

    void (async () => {
      const mergeSummaries = (summaries: Record<string, string>) => {
        setLlmStepTitles((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const [k, v] of Object.entries(summaries)) {
            if (v && v !== prev[k]) {
              next[k] = v;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      };

      for (let offset = 0; offset < tasks.length; offset += STEPS_PER_REQUEST) {
        const chunk = tasks.slice(offset, offset + STEPS_PER_REQUEST);
        const chunkKeys = chunk.map((c) => c.key);
        chunkKeys.forEach((k) => stepLlmRequestedRef.current.add(k));
        try {
          const res = await fetch("/api/chat/process-steps-summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelConfig: {
                modelName: cfg.modelName,
                baseUrl: cfg.baseUrl,
                apiKey: cfg.apiKey,
              },
              steps: chunk.map((t) => ({
                key: t.key,
                toolName: t.toolName,
                step: t.step,
                status: t.status,
                detail: t.detail,
                inputPreview: t.inputPreview,
                outputPreview: t.outputPreview,
              })),
            }),
          });
          if (!res.ok) throw new Error("process-steps-summarize failed");
          const data = (await res.json()) as { summaries?: Record<string, string> };
          mergeSummaries(data.summaries ?? {});
        } catch {
          chunkKeys.forEach((k) => stepLlmRequestedRef.current.delete(k));
          break;
        }
      }
    })();
  }, [sorted, modelConfigs]);

  if (!sorted.length) return null;

  function isLowSignalDetail(text?: string) {
    const normalized = (text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return true;
    if (/^(已获得阶段思考信息|阶段.+更新|该步骤已执行。?)$/.test(normalized)) return true;
    if (/^[。！？,.!?\s]+$/.test(normalized)) return true;
    return false;
  }

  function renderUserBlock(block: ContentBlock, idx: number) {
    if (!block) return null;
    if (block.type === "text") {
      return (
        <span key={`txt-${idx}`} className="inline align-middle whitespace-pre-wrap break-keep">
          {block.text}
        </span>
      );
    }
    if (block.type === "skill_card") {
      return (
        <span
          key={`skill-${idx}`}
          className="mx-0.5 inline-flex shrink-0 items-center gap-1.5 align-middle rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-sm leading-5 text-blue-700 first:ml-0"
        >
          <Sparkles className="size-4 shrink-0" />
          {displaySkillNameFromBlock(block.name, block.skillId, t)}
        </span>
      );
    }
    return (
      <span
        key={`file-${idx}`}
        className="mx-0.5 inline-flex shrink-0 items-center gap-1.5 align-middle rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-sm leading-5 text-amber-700 first:ml-0"
      >
        <FileText className="size-4 shrink-0" />
        {block.name}
      </span>
    );
  }

  function toStepLabel(step: string) {
    const normalized = step.toLowerCase();
    if (["understand", "thinking", "analysis", "intent"].includes(normalized)) return "理解目标";
    if (["plan", "planner"].includes(normalized)) return "制定计划";
    if (["execute", "execution", "tool", "tools"].includes(normalized)) return "执行任务";
    if (["reflect", "reflection", "review"].includes(normalized)) return "结果复核";
    if (["complete"].includes(normalized)) return "结果整理";
    if (/^call_[a-z0-9]+$/i.test(step.trim())) return "工具返回";
    if (["hermes", "chat_turn", "direct_model"].includes(normalized)) return step;
    return humanizeHermesToolName(step);
  }

  function buildStepLogProcessItem(messageId: string, item: StepLog, idx: number): ProcessActionItem {
    const rawMsg = item.message || "";
    const proseRaw = item.kind === "phase" ? null : extractProseBeforeJson(rawMsg);
    const detail =
      normalizeReadableText(humanizeHermesProcessMessage(rawMsg)) || "该步骤已执行。";
    const proseAbovePill = proseRaw
      ? normalizeReadableText(humanizeHermesProcessMessage(proseRaw))
      : undefined;
    return {
      id: `${messageId}-step-${idx}-${item.traceId ?? "noid"}`,
      label: toStepLabel(item.step),
      kind: item.kind,
      toolName: item.toolName,
      proseAbovePill: proseAbovePill || undefined,
      status: item.status === "error" ? "失败" : item.status === "running" ? "进行中" : "完成",
      detail,
      latencyMs: item.latencyMs,
      errorCode: normalizeReadableText(item.errorCode),
      inputPreview: normalizeReadableText(item.inputPreview),
      outputPreview: normalizeReadableText(item.outputPreview),
      traceId: normalizeReadableText(item.traceId),
    };
  }

  function prettifyJsonBlock(raw: string): string {
    const t = raw.trim();
    if (!t) return t;
    if (t.length > UI_JSON_PRETTIFY_MAX) {
      return `${t.slice(0, UI_JSON_PRETTIFY_MAX)}\n\n…（内容过长，已截断展示；完整结果以助手正文或导出文件为准）`;
    }
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      return t;
    }
  }

  /** 一键复制用：单条工具/步骤的完整原文（不省略 JSON） */
  function formatProcessDetailForCopy(item: ProcessActionItem): string {
    const lines: string[] = [];
    lines.push(`🔧 ${item.label} · ${item.status}`);
    lines.push(`详情:\n${prettifyJsonBlock(item.detail)}`);
    if (item.latencyMs != null) lines.push(`耗时: ${item.latencyMs}ms`);
    if (item.errorCode) lines.push(`错误码: ${item.errorCode}`);
    if (item.inputPreview) lines.push(`输入摘要:\n${prettifyJsonBlock(item.inputPreview)}`);
    const detailWs = collapseWs(item.detail);
    const outWs = item.outputPreview ? collapseWs(item.outputPreview) : "";
    const duplicateOut = outWs && detailWs && outWs === detailWs;
    if (item.outputPreview && !duplicateOut) {
      lines.push(`输出摘要:\n${prettifyJsonBlock(item.outputPreview)}`);
    }
    if (item.traceId) lines.push(`追踪ID: ${item.traceId}`);
    return lines.join("\n");
  }

  function getProcessEmptyHintForCopy(): string {
    return runtimeInfo.upstreamMode === "model-direct"
      ? "本轮为直连模型执行，未返回可展开的过程事件（无 reasoning/tool 明细）。下方助手正文仍有效。"
      : runtimeInfo.upstreamMode === "hermes"
        ? "本轮 Hermes 未推送可展开的中间步骤（常见于纯文本回复、本回合未走工具链，或 SSE 未含 reasoning/tool 事件）。不代表失败；请直接阅读下方助手回复。若要评测技能，请在正文里说明目标（如 Route C + 技能 id 或粘贴 SKILL.md）。"
        : "本轮未返回可展开的过程事件明细（上游状态未知或未上报中间步骤）。下方助手正文仍有效。";
  }

  /** 与界面过程区同源数据，导出为纯文本供剪贴板使用（含折叠区内的完整 JSON） */
  function buildProcessPlainTextForCopy(m: ChatMessage): string {
    const emptyHint = getProcessEmptyHintForCopy();
    const messageId = m.id;
    const thinkingText = m.process?.thinkingText ?? "";
    const executionLogs = m.process?.executionLogs ?? [];
    const stepLogs = m.stepLogs;

    /** 与过程区展示一致：结构化 stepLogs 全部展示为胶囊条，不因「低信号」隐藏。 */
    const keepActionItem = () => true;

    if (m.processTimeline?.length) {
      const flat = flattenTimelineForProcessArea(m.processTimeline);
      if (!flat.length) return emptyHint;
      const chunks: string[] = [];
      flat.forEach((row, i) => {
        if (row.kind === "narrative") {
          const t = row.text.replace(/\s+/g, " ").trim();
          if (t) chunks.push(row.text.trim());
        } else {
          const item = buildStepLogProcessItem(messageId, row.log, i);
          chunks.push(`${item.label} · ${item.status}\n${formatProcessDetailForCopy(item)}`);
        }
      });
      return chunks.filter(Boolean).join("\n\n") || emptyHint;
    }

    if (stepLogs?.length) {
      const merged = dedupeToolStepsByTraceId(stepLogs);
      const actionItemsFromSteps = merged.map((it, i) => buildStepLogProcessItem(messageId, it, i)).filter(keepActionItem);
      if (actionItemsFromSteps.length === 0) return emptyHint;
      return actionItemsFromSteps
        .map((item) => `${item.label} · ${item.status}\n${formatProcessDetailForCopy(item)}`)
        .join("\n\n");
    }

    const narrative = thinkingText
      .replace(/\s+/g, " ")
      .split(/(?<=[。！？])/)
      .map((line) => normalizeReadableText(line))
      .filter((line) => Boolean(line) && !/^[。！？,.!?\s]+$/.test(line))
      .filter((line, idx, arr) => arr.findIndex((v) => v === line) === idx);
    const actionItems: ProcessActionItem[] = executionLogs
      .map((line, idx) => {
        const cleaned = line
          .replace(/^>\s*/, "")
          .replace(/\.\.\./g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleaned) return null;
        const stepName =
          cleaned.includes(" … ")
            ? (cleaned.split(" … ")[0]?.trim() ?? "")
            : (cleaned.split("(")[0]?.trim() ?? "");
        const detail = humanizeHermesProcessMessage(cleaned);
        return {
          id: `${messageId}-exec-${idx}`,
          label: toStepLabel(stepName || "执行步骤"),
          status: cleaned.includes("Failed") ? "失败" : cleaned.includes("Running") ? "进行中" : "完成",
          detail,
        };
      })
      .filter((item): item is ProcessActionItem => item !== null);

    const lines = narrative.length ? narrative : [normalizeReadableText(thinkingText) || "..."];
    const filteredLines = lines.filter((line) => !isLowSignalDetail(line));
    const effectiveLines = filteredLines.length ? filteredLines : lines;
    if (!effectiveLines.some((line) => !isLowSignalDetail(line)) && actionItems.length === 0) {
      return emptyHint;
    }

    const blocks: string[] = [];
    effectiveLines.forEach((line, idx) => {
      const currentAction = actionItems[idx];
      blocks.push(line);
      if (currentAction) blocks.push(formatProcessDetailForCopy(currentAction));
    });
    if (actionItems.length > effectiveLines.length) {
      actionItems.slice(effectiveLines.length).forEach((item) => {
        blocks.push(`${item.label} · ${item.status}`);
        blocks.push(formatProcessDetailForCopy(item));
      });
    }
    return blocks.join("\n\n");
  }

  function buildAssistantMessageCopyText(m: ChatMessage): string {
    if (m.role !== "assistant") return "";
    const parts: string[] = [];
    if (m.process) {
      const statusLine =
        m.process.status === "running"
          ? `运行中 ${formatDuration(m.process.startedAt)}`
          : `${m.process.status === "completed" ? "已完成" : "失败"} ${formatDuration(
              m.process.startedAt,
              m.process.endedAt,
            )}`;
      parts.push(`【状态】${statusLine}`);
      parts.push(`【过程】\n${buildProcessPlainTextForCopy(m)}`);
    }
    const bodyForCopy = surfaceAssistantMarkdownBody(m).trim();
    parts.push(`【正文】\n${bodyForCopy}`);
    const surfaced = surfaceAssistantMarkdownBody(m).trim();
    const full = (m.text || "").trim();
    if (full && surfaced !== full) {
      parts.push(`【全文存档】\n${full}`);
    }
    if (m.cards?.length) {
      parts.push(
        `【卡片】\n${m.cards.map((c) => JSON.stringify(c, null, 2)).join("\n\n----------\n\n")}`,
      );
    }
    return parts.filter(Boolean).join("\n\n").trim();
  }

  async function copyAssistantMessageToClipboard(m: ChatMessage) {
    const payload = buildAssistantMessageCopyText(m);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyFlashId(m.id);
      window.setTimeout(() => setCopyFlashId((id) => (id === m.id ? null : id)), 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopyFlashId(m.id);
        window.setTimeout(() => setCopyFlashId((id) => (id === m.id ? null : id)), 2000);
      } catch {
        /* ignore */
      }
    }
  }

  async function copyUserMessageToClipboard(m: ChatMessage) {
    const textFromBlocks =
      m.blocks
        ?.map((b) => {
          if (b.type === "text") return b.text;
          if (b.type === "skill_card") return normalizeSkillCreatorDisplayName(b.name, b.skillId);
          return b.name;
        })
        .filter(Boolean)
        .join("\n") ?? "";
    const plain = m.text?.trim() || textFromBlocks.trim();
    if (!plain) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(plain);
      } else {
        const ta = document.createElement("textarea");
        ta.value = plain;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyFlashId(m.id);
      window.setTimeout(() => setCopyFlashId((id) => (id === m.id ? null : id)), 2000);
    } catch {
      /* ignore */
    }
  }

  type AssistantUiState = "IDLE" | "THINKING" | "STREAMING" | "TOOL_EXECUTING" | "COMPLETE" | "ERROR";

  function pickRunningTool(logs: ChatMessage["stepLogs"] | undefined) {
    if (!logs?.length) return null;
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i]!;
      if ((l.kind === "tool" || !!l.toolName) && l.status === "running") return l;
    }
    return null;
  }

  function deriveAssistantUiState(m: ChatMessage): AssistantUiState {
    if (m.role !== "assistant") return "COMPLETE";
    const p = m.process;
    if (!p) return "COMPLETE";
    if (p.status === "failed" || p.phase === "failed") return "ERROR";
    if (p.status === "completed" || p.phase === "completed") return "COMPLETE";
    if (pickRunningTool(m.stepLogs)) return "TOOL_EXECUTING";
    if ((m.text ?? "").trim().length > 0 || p.phase === "streaming") return "STREAMING";
    if (connectionStatus === "connecting") return "IDLE";
    return "THINKING";
  }

  function renderAssistantStateIndicator(m: ChatMessage, uiState: AssistantUiState) {
    /** 首包前思考态由本条 `renderAssistantProcessChrome` 展示，避免与条内 Loader 重复 */
    if (
      m.id === lastAssistantId &&
      (uiState === "THINKING" || uiState === "IDLE")
    ) {
      return null;
    }
    if (
      uiState === "COMPLETE" ||
      uiState === "ERROR" ||
      uiState === "STREAMING" ||
      uiState === "TOOL_EXECUTING"
    ) {
      return null;
    }
    return (
      <div className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="size-4 animate-spin text-gray-500" aria-hidden />
        <span>{uiState === "IDLE" ? "正在思考..." : "正在分析需求..."}</span>
      </div>
    );
  }

  function renderProcessDetails(m: ChatMessage) {
    const messageId = m.id;
    const thinkingText = m.process?.thinkingText ?? "";
    const executionLogs = m.process?.executionLogs ?? [];
    const stepLogs = m.stepLogs;
    const processTimeline = m.processTimeline;

    const emptyHint = getProcessEmptyHintForCopy();

    const keepActionItem = () => true;

    function renderToolStepTechnicalDetails(item: ProcessActionItem) {
      const detailWs = collapseWs(item.detail);
      const outWs = item.outputPreview ? collapseWs(item.outputPreview) : "";
      const duplicateOut = outWs && detailWs && outWs === detailWs;
      return (
        <div className="space-y-3 text-xs text-gray-600">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-gray-200/80 bg-white/90 p-2.5 leading-relaxed text-gray-800 dark:border-slate-600 dark:bg-slate-900/90 dark:text-slate-200">
            {prettifyJsonBlock(item.detail)}
          </pre>
          {item.latencyMs != null ? <p>耗时：{item.latencyMs}ms</p> : null}
          {item.errorCode ? <p>错误码：{item.errorCode}</p> : null}
          {item.inputPreview ? (
            <div>
              <p className="mb-1 font-medium text-gray-700">输入摘要</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-gray-200/80 bg-white/90 p-2 dark:border-slate-600 dark:bg-slate-900/90 dark:text-slate-200">
                {prettifyJsonBlock(item.inputPreview)}
              </pre>
            </div>
          ) : null}
          {!duplicateOut && item.outputPreview ? (
            <div>
              <p className="mb-1 font-medium text-gray-700">输出摘要</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-gray-200/80 bg-white/90 p-2 dark:border-slate-600 dark:bg-slate-900/90 dark:text-slate-200">
                {prettifyJsonBlock(item.outputPreview)}
              </pre>
            </div>
          ) : null}
          {item.traceId ? <p className="text-[11px] text-gray-500">追踪ID：{item.traceId}</p> : null}
        </div>
      );
    }

    function hasExpandableTechnicalBlock(item: ProcessActionItem): boolean {
      const detailWs = collapseWs(item.detail);
      const outWs = item.outputPreview ? collapseWs(item.outputPreview) : "";
      const duplicateOut = outWs && detailWs && outWs === detailWs;
      return (
        detailWs.length > 80 ||
        !!item.inputPreview?.trim() ||
        (!!item.outputPreview?.trim() && !duplicateOut) ||
        !!item.traceId ||
        item.latencyMs != null ||
        !!item.errorCode
      );
    }

    /** 单行固定高度：只展示「工具在做什么」的意图句，详情在展开区 */
    function pillShellClass(showChevron: boolean, failed: boolean, runningWave = false) {
      const baseTone =
        "inline-flex h-10 min-h-10 max-h-10 w-max max-w-[min(100%,36rem)] min-w-[10rem] shrink-0 items-center gap-2.5 rounded-xl border border-[#E6E6E4] bg-[#F3F3F1] px-3.5 py-0 text-sm leading-none box-border overflow-hidden dark:border-slate-600 dark:bg-slate-800 text-gray-800 dark:text-slate-100";
      return [
        baseTone,
        showChevron ? "cursor-pointer hover:bg-[#EBEBE8] dark:hover:bg-slate-700/90" : "",
        failed ? "border-red-200/80 bg-red-50/90 text-red-900 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-100" : "",
        runningWave ? "tool-pill--running relative overflow-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ");
    }

    function isRunningToolCapsule(item: ProcessActionItem): boolean {
      if (item.status !== "进行中" || item.kind === "phase") return false;
      return item.kind === "tool" || !!(item.toolName?.trim() ?? "").length;
    }

    function renderProcessStepCard(item: ProcessActionItem) {
      if (item.kind === "phase") {
        const { heading, body } = splitPhaseHeadingBody(item.detail);
        const phaseExpandable = !!(body?.trim() || item.detail.length > 140);
        const phaseTitle = heading.length > 72 ? `${heading.slice(0, 72)}…` : heading;
        const summaryRowPhase = (showChevron: boolean) => (
          <div className={pillShellClass(showChevron, false)}>
            {processStepLeadingIcon(item)}
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left font-medium">
              {phaseTitle}
            </span>
            {showChevron ? (
              <ChevronRight
                className="size-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90"
                aria-hidden
              />
            ) : null}
          </div>
        );
        if (!phaseExpandable) {
          return (
            <div key={item.id} className="min-w-0 w-full max-w-full">
              {summaryRowPhase(false)}
            </div>
          );
        }
        return (
          <div key={item.id} className="min-w-0 w-full max-w-full space-y-1.5">
            <details className="group min-w-0 w-full space-y-1.5">
              <summary className="list-none [&::-webkit-details-marker]:hidden">{summaryRowPhase(true)}</summary>
              <div className="rounded-xl border border-[#E8E8E6] bg-[#FAFAF8] px-3 py-2.5 text-[15px] leading-7 text-gray-800">
                {body ? <div className="whitespace-pre-wrap">{body}</div> : null}
              </div>
            </details>
          </div>
        );
      }

      const heuristicLine = compactRedundantToolNarrative(summarizeJsonBlobForPill(item.detail));
      const llmLine = llmStepTitles[item.id];
      const friendly = llmLine && !looksLikeRawJsonStepSummary(llmLine) ? llmLine : heuristicLine;
      const pillTitle =
        item.status === "失败"
          ? friendly || `${item.label} 执行失败，请展开查看明细。`
          : item.status === "进行中"
            ? friendly || `${item.label} 进行中…`
            : friendly || item.label;
      const expandable = hasExpandableTechnicalBlock(item);
      const countHint = tryItemCountSuffix(item.detail, item.outputPreview);

      const proseBlock =
        item.proseAbovePill && item.proseAbovePill.trim() ? (
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800 dark:text-slate-200">{item.proseAbovePill}</p>
        ) : null;

      const runningWave = isRunningToolCapsule(item);
      const summaryRow = (showChevron: boolean) => (
        <div className={pillShellClass(showChevron, item.status === "失败", runningWave)}>
          <span className="shrink-0">{processStepLeadingIcon(item)}</span>
          <div className="flex min-w-0 max-w-full flex-1 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left font-medium">{pillTitle}</span>
            {countHint ? (
              <span className="shrink-0 whitespace-nowrap text-[13px] font-normal text-gray-500 dark:text-slate-400">
                {countHint}
              </span>
            ) : null}
          </div>
          {showChevron ? (
            <ChevronRight
              className="size-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90 dark:text-slate-500"
              aria-hidden
            />
          ) : null}
        </div>
      );

      if (!expandable) {
        return (
          <div key={item.id} className="min-w-0 w-full max-w-full space-y-2">
            {proseBlock}
            {summaryRow(false)}
          </div>
        );
      }

      return (
        <div key={item.id} className="min-w-0 w-full max-w-full space-y-2">
          {proseBlock}
          <details className="group min-w-0 w-full space-y-1.5">
            <summary className="list-none [&::-webkit-details-marker]:hidden">{summaryRow(true)}</summary>
            <div className="rounded-xl border border-[#E8E8E6] bg-[#FAFAF8] px-3 py-3 text-xs text-gray-600 dark:border-slate-600 dark:bg-slate-900/85 dark:text-slate-300">
              {renderToolStepTechnicalDetails(item)}
            </div>
          </details>
        </div>
      );
    }

    /** 有 processTimeline 时：叙述与工具/阶段严格按 Hermes 流式到达顺序交错展示（叙述为纯文本块，工具行样式与仅 stepLogs 时一致：胶囊 + 技术区） */
    if (processTimeline?.length) {
      const flat = flattenTimelineForProcessArea(processTimeline);
      if (!flat.length) {
        return (
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-slate-900 dark:text-slate-400">{emptyHint}</div>
        );
      }
      return (
        <div className="space-y-2">
          {flat.map((row, idx) =>
            row.kind === "narrative" ? (
              <div
                key={`${messageId}-tl-nar-${idx}`}
                className={`min-w-0 pl-0.5 ${ASSISTANT_MARKDOWN_BODY_CLASS}`}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {String(normalizeMarkdownForRemark(row.text) || "")}
                </ReactMarkdown>
              </div>
            ) : (
              <div key={`${messageId}-tl-st-${idx}`} className="min-w-0">
                {renderProcessStepCard(buildStepLogProcessItem(messageId, row.log, idx))}
              </div>
            ),
          )}
        </div>
      );
    }

    /** 仅有 stepLogs、无时间线时按事件顺序纵向展示 */
    if (stepLogs?.length) {
      const merged = dedupeToolStepsByTraceId(stepLogs);
      const actionItemsFromSteps = merged.map((it, i) => buildStepLogProcessItem(messageId, it, i)).filter(keepActionItem);
      if (actionItemsFromSteps.length === 0) {
        return (
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-slate-900 dark:text-slate-400">{emptyHint}</div>
        );
      }
      return (
        <div className="space-y-2">
          {actionItemsFromSteps.map((item) => renderProcessStepCard(item))}
        </div>
      );
    }

    const narrative = thinkingText
      .replace(/\s+/g, " ")
      .split(/(?<=[。！？])/)
      .map((line) => normalizeReadableText(line))
      .filter((line) => Boolean(line) && !/^[。！？,.!?\s]+$/.test(line))
      .filter((line, idx, arr) => arr.findIndex((v) => v === line) === idx);
    const actionItems: ProcessActionItem[] = executionLogs
      .map((line, idx) => {
        const cleaned = line
          .replace(/^>\s*/, "")
          .replace(/\.\.\./g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleaned) return null;
        const stepName =
          cleaned.includes(" … ")
            ? (cleaned.split(" … ")[0]?.trim() ?? "")
            : (cleaned.split("(")[0]?.trim() ?? "");
        const detail = humanizeHermesProcessMessage(cleaned);
        return {
          id: `${messageId}-exec-${idx}`,
          label: toStepLabel(stepName || "执行步骤"),
          status: cleaned.includes("Failed") ? "失败" : cleaned.includes("Running") ? "进行中" : "完成",
          detail,
        };
      })
      .filter((item): item is ProcessActionItem => item !== null);

    const lines = narrative.length ? narrative : [normalizeReadableText(thinkingText) || "..."];
    const filteredLines = lines.filter((line) => !isLowSignalDetail(line));
    const effectiveLines = filteredLines.length ? filteredLines : lines;
    if (!effectiveLines.some((line) => !isLowSignalDetail(line)) && actionItems.length === 0) {
      return (
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-slate-900 dark:text-slate-400">{emptyHint}</div>
      );
    }

    return (
      <div className="space-y-3">
        {effectiveLines.map((line, idx) => {
          const currentAction = actionItems[idx];
          if (currentAction) {
            return (
              <div key={`${messageId}-narrative-${idx}`}>
                {renderProcessStepCard(currentAction)}
              </div>
            );
          }
          return (
            <div key={`${messageId}-narrative-${idx}`} className="pl-0.5 text-[15px] leading-7 text-gray-800">
              {compactRedundantToolNarrative(summarizeJsonBlobForPill(line))}
            </div>
          );
        })}
        {actionItems.length > effectiveLines.length
          ? actionItems.slice(effectiveLines.length).map((item, j) => (
              <div key={`${messageId}-action-rest-${j}`}>
                {renderProcessStepCard(item)}
              </div>
            ))
          : null}
      </div>
    );
  }

  /**
   * 过程区顶栏：
   * - 任意已结束（成功/失败）的助手条都展示「已完成/失败 + 耗时」折叠头。此前仅在
   *   `lastAssistantId === m.id && 时间序最后一条也是 m` 时展示，用户发起新一轮后最后一条变为用户气泡，
   *   条件失效，历史「已完成」被错误隐藏。
   * - 「思考中/运行中」仅作用于时间序最后一条、且为线程中最后一条助手、且仍在 running 的消息。
   */
  function renderAssistantProcessChrome(m: ChatMessage) {
    if (m.role !== "assistant" || !m.process) return null;
    const p = m.process;
    const lastSortedMsg = sorted[sorted.length - 1];
    const isChronologicallyLastMessage = lastSortedMsg?.id === m.id;
    const isLastAssistantInThread = m.id === lastAssistantId;

    const finished = assistantMessageFinished(m) && (p.status === "completed" || p.status === "failed");
    if (finished) {
      if (!assistantProcessHasToolSteps(m.processTimeline, m.stepLogs)) {
        return null;
      }
      return (
        <details className="group/pfold mb-4">
          <summary className="mb-2 flex cursor-pointer list-none items-center gap-2 text-[15px] text-gray-800 hover:text-gray-900 dark:text-slate-200 dark:hover:text-slate-50 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-gray-400 transition-transform group-open/pfold:rotate-90 dark:text-slate-500"
              aria-hidden
            />
            <span
              className={`font-semibold ${p.status === "failed" ? "text-red-700 dark:text-red-300" : "text-gray-700 dark:text-slate-300"}`}
            >
              {p.status === "failed" ? "失败" : "已完成"}
            </span>
            <span className="tabular-nums text-gray-600 dark:text-slate-400">{formatDuration(p.startedAt, p.endedAt)}</span>
          </summary>
          <div className="mt-1 border-t border-transparent pt-1">
            {renderProcessDetails(m)}
          </div>
        </details>
      );
    }

    if (isChronologicallyLastMessage && isLastAssistantInThread && p.status === "running") {
      const hasInFlightActivity =
        assistantProcessHasToolSteps(m.processTimeline, m.stepLogs) ||
        !!(m.text?.trim()) ||
        (p.executionLogs?.length ?? 0) > 0;
      const isThinking =
        (p.phase === "waiting_first_chunk" || p.phase === "sending") && !hasInFlightActivity;
      return (
        <>
          <div className="mb-2" role="status" aria-live="polite">
            {isThinking ? (
              <div className="inline-flex animate-pulse items-center gap-3 text-[15px] text-gray-700 dark:text-slate-300">
                <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-gray-400 dark:bg-slate-500" aria-hidden />
                <span className="font-medium">思考中</span>
              </div>
            ) : (
              <div className="inline-flex items-baseline gap-2 text-[15px] text-gray-800 dark:text-slate-200">
                <span className="font-semibold">运行中</span>
                <span className="tabular-nums text-gray-600 dark:text-slate-400">{formatDuration(p.startedAt)}</span>
              </div>
            )}
          </div>
          <div className="mb-4">
            {renderProcessDetails(m)}
          </div>
        </>
      );
    }

    return (
      <div className="mb-4">
        {renderProcessDetails(m)}
      </div>
    );
  }

  return (
    <section ref={scrollRootRef} className="chat-scroll-area min-h-0 flex flex-1 overflow-auto py-0">
      <div className={`mx-auto flex w-full max-w-4xl flex-col gap-3 px-1 pb-10 ${firstMessageIsUser ? "pt-5" : ""}`}>
        {isDebugMode && contextHint ? (
          <div className="rounded-lg bg-gray-100/80 px-3 py-2 text-xs text-gray-500 dark:bg-slate-800/80 dark:text-slate-400">
            {contextHint}
          </div>
        ) : null}
        {isDebugMode && connectionStatus !== "idle" ? (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-slate-900 dark:text-slate-400">
            {`链路状态：${connectionStatus}`}
            {runtimeInfo.upstreamMode !== "unknown" ? ` · 上游：${runtimeInfo.upstreamMode}` : ""}
            {runtimeInfo.firstTokenLatencyMs ? ` · 首字延迟：${runtimeInfo.firstTokenLatencyMs}ms` : ""}
            {runtimeInfo.traceId ? ` · Trace：${runtimeInfo.traceId}` : ""}
            {runtimeInfo.lastError ? ` · 错误：${runtimeInfo.lastError}` : ""}
          </div>
        ) : null}
        {sorted.map((m, idx) => {
          const uiState = deriveAssistantUiState(m);
          let surfaceMd = m.role === "assistant" ? surfaceAssistantMarkdownBody(m) : "";
          /** 运行中仅展示过程区时间线，正文区留空，避免与过程叙述重复且半成品无 Markdown 结构 */
          if (m.role === "assistant" && m.process?.status === "running") {
            surfaceMd = "";
          }
          const surfaceTrim = surfaceMd.trim();
          const surfaceMdForMarkdown =
            m.role === "assistant" ? normalizeMarkdownForRemark(surfaceMd) : surfaceMd;
          const hasTimelineNarrative =
            m.role === "assistant" &&
            !!m.processTimeline?.some((e) => e.kind === "narrative" && e.text.trim());
          const hasToolProcessSteps =
            m.role === "assistant"
              ? assistantProcessHasToolSteps(m.processTimeline, m.stepLogs)
              : false;
          // 仅当确有正文区可展示时再画分隔线；无工具过程时不画（避免纯直达回复上方空线）。
          const showResultDivider =
            m.role === "assistant" &&
            !!m.process &&
            surfaceTrim.length > 0 &&
            (hasToolProcessSteps || !assistantMessageFinished(m) || m.process.status === "running");
          const prevMsg = idx > 0 ? sorted[idx - 1] : undefined;
          const followUpChips: [string, string, string] | null =
            m.role === "assistant" && assistantMessageFinished(m)
              ? buildAssistantFollowUpChips({
                  assistantPlain: (m.text || "").slice(0, 4000),
                  lastUserPlain:
                    prevMsg?.role === "user" ? userMessagePlainHint(prevMsg) : undefined,
                })
              : null;
          return (
          <article
            key={m.id}
            className={`group flex ${m.role === "user" ? "justify-end" : "justify-start"} ${idx === 0 ? "mt-5" : ""}`}
          >
            <div className={m.role === "user" ? "max-w-2xl" : "w-full"}>
              {m.role === "assistant" ? renderAssistantStateIndicator(m, uiState) : null}
              {m.role === "assistant" && m.process ? renderAssistantProcessChrome(m) : null}
              <div className={m.role === "user" ? "flex justify-end" : "w-full"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-full min-w-0 rounded-2xl rounded-br-sm bg-[#F3F3F1] px-4 py-2 text-gray-800 sm:max-w-[min(100%,36rem)] dark:bg-slate-800 dark:text-slate-100"
                      : `w-full bg-transparent text-sm leading-7 text-gray-800 dark:text-slate-200${showResultDivider ? " mt-1 border-t border-gray-200/80 pt-3 dark:border-slate-700" : ""}`
                  }
                >
                  {m.role === "user" && m.blocks?.length ? (
                    <div className="text-[15px] leading-7 break-keep [&>span]:align-middle">
                      {m.blocks.map((b, i) => renderUserBlock(b, i))}
                    </div>
                  ) : m.role === "user" ? (
                    <div className="max-w-full overflow-x-auto whitespace-pre-wrap text-[15px] leading-7 break-keep">
                      {m.text}
                    </div>
                  ) : (
                    <>
                      {assistantMessageFinished(m) && hasTimelineNarrative && !surfaceTrim ? (
                        <p className="mb-2 text-[13px] leading-relaxed text-gray-500 dark:text-slate-400">
                          本轮未单独输出总结段落（探索过程见上方「已完成」内时间线）。若需面向用户的润色结论，请在技能中约定模型在结束前输出带标题的段落，例如「## 审核报告」「## 数据缺口预警」「## 最终结论」等。
                        </p>
                      ) : null}
                      <div className={ASSISTANT_MARKDOWN_BODY_CLASS}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {String(surfaceMdForMarkdown || "")}
                        </ReactMarkdown>
                      </div>
                      {assistantMessageStreaming(m) && surfaceTrim.length > 0 ? (
                        <span className="ml-0.5 inline-block text-gray-700 animate-pulse dark:text-slate-300" aria-hidden>
                          |
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {m.cards?.length ? <AdaptiveCardRenderer cards={m.cards} /> : null}

              {m.role === "assistant" && uiState === "ERROR" ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
                  <div className="font-medium">对话执行异常</div>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-200">{runtimeInfo.lastError || m.text || "网络连接超时或工具执行失败"}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 dark:bg-slate-800 dark:text-red-200 dark:hover:bg-slate-700"
                      onClick={() => void retryLatestTurn()}
                    >
                      重试
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 dark:bg-slate-800 dark:text-red-200 dark:hover:bg-slate-700"
                      onClick={() =>
                        setMessageVote((prev) => ({
                          ...prev,
                          [m.id]: "down",
                        }))
                      }
                    >
                      反馈
                    </button>
                  </div>
                </div>
              ) : null}

              {m.role === "user" ? (
                <div className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-gray-400 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto dark:text-slate-500">
                  <span className="tabular-nums">{formatUserMessageTime(m.createdAt)}</span>
                  <button
                    type="button"
                    title="复制"
                    className="rounded-md bg-transparent p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={() => void copyUserMessageToClipboard(m)}
                  >
                    {copyFlashId === m.id ? (
                      <Check className="size-3.5 text-emerald-600" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                  </button>
                </div>
              ) : null}

              {m.role === "assistant" && assistantMessageFinished(m) ? (
                <>
                  <div
                    className="mt-2 flex items-center gap-0.5 pt-2"
                    role="toolbar"
                    aria-label="本条助手回复操作"
                  >
                    <button
                      type="button"
                      title="复制全文"
                      className="rounded-lg bg-transparent p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      onClick={() => void copyAssistantMessageToClipboard(m)}
                    >
                      {copyFlashId === m.id ? (
                        <Check className="size-4 text-emerald-600" aria-hidden />
                      ) : (
                        <Copy className="size-4" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      title="点赞"
                      className={`rounded-lg p-2 transition hover:bg-gray-100 dark:hover:bg-slate-800 ${
                        messageVote[m.id] === "up"
                          ? "bg-transparent text-sky-600 dark:text-sky-400"
                          : "bg-transparent text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100"
                      }`}
                      onClick={() =>
                        setMessageVote((prev) => {
                          const next = { ...prev };
                          if (next[m.id] === "up") delete next[m.id];
                          else next[m.id] = "up";
                          return next;
                        })
                      }
                    >
                      <ThumbsUp className={`size-4 ${messageVote[m.id] === "up" ? "fill-current" : ""}`} aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="点踩"
                      className={`rounded-lg p-2 transition hover:bg-gray-100 dark:hover:bg-slate-800 ${
                        messageVote[m.id] === "down"
                          ? "bg-transparent text-amber-700 dark:text-amber-400"
                          : "bg-transparent text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100"
                      }`}
                      onClick={() =>
                        setMessageVote((prev) => {
                          const next = { ...prev };
                          if (next[m.id] === "down") delete next[m.id];
                          else next[m.id] = "down";
                          return next;
                        })
                      }
                    >
                      <ThumbsDown
                        className={`size-4 ${messageVote[m.id] === "down" ? "fill-current" : ""}`}
                        aria-hidden
                      />
                    </button>
                    <button
                      type="button"
                      title={
                        m.id === lastAssistantId
                          ? "重新生成"
                          : "仅支持对最后一条助手回复重新生成（将丢弃其后对话）"
                      }
                      disabled={isLoading || m.id !== lastAssistantId}
                      className="rounded-lg bg-transparent p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      onClick={() =>
                        void sendMessage({
                          text: "",
                          blocks: [],
                          model: "自动",
                          replaceAssistantId: m.id,
                        })
                      }
                    >
                      <RotateCw className="size-4" aria-hidden />
                    </button>
                  </div>
                  {followUpChips ? (
                    <div
                      className="mt-2.5 mb-2.5 flex w-full max-w-full flex-col items-start gap-1.5"
                      role="group"
                      aria-label="猜你想继续问"
                    >
                      {followUpChips.map((label, chipIdx) => (
                        <button
                          key={`${m.id}-follow-${chipIdx}`}
                          type="button"
                          title={label}
                          className="inline-flex h-9 min-h-9 max-h-9 w-max min-w-[10.5rem] max-w-[min(100%,36rem)] shrink-0 items-center overflow-hidden rounded-full border border-[#E5E5E5] bg-white px-3.5 text-left text-[15px] leading-none text-gray-900 shadow-none transition hover:bg-[#FAFAFA] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                          onClick={() => requestComposerInsertText(label)}
                        >
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

