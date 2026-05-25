import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { MessageCard } from "@/components/chat/types";
import {
  DATA_RULE_AUDIT_WIZARD_SYSTEM_PROMPT,
  isDataRuleAuditWizardRequest,
} from "@/lib/data-rule-audit-wizard";
import {
  DATASOURCE_DB_WIZARD_SYSTEM_PROMPT,
  formToDatasourceRecord,
  isDatasourceWizardRequest,
  parseWizardDbPayload,
} from "@/lib/datasource-wizard";
import { executeDatasourceWizardTool, getDatasourceWizardChatTools } from "@/lib/datasource-tool-executor";
import {
  loadHermesSkillMarkdownForTurn,
  type HermesTurnSkillLoadResult,
} from "@/lib/hermes-turn-skill-loader";
import { defaultHermesV1Bases } from "@/lib/hermes-default-gateway-roots";
import { buildHermesAttachmentDirectiveForBlocks } from "@/lib/chat-attachment-hermes";
import { maybeBuildBaodanStagingSuffix } from "@/lib/baodan-hermes-staging";
import {
  hermesStreamConnectTimeoutMs,
  hermesSseClientHeartbeatMs,
  hermesStreamIdleTimeoutMs,
  hermesStreamMaxDurationMs,
  readStreamChunkWithIdleTimeout,
} from "@/lib/hermes-stream-timeout";
import {
  STEP_LOG_MESSAGE_MAX,
  STEP_LOG_PREVIEW_MAX,
  clampStepLogFields,
  truncateProcessText,
} from "@/lib/process-payload-limit";
import { dedupeToolStepsByTraceId } from "@/lib/process-timeline";

type TurnRequest = {
  sessionId?: string;
  text?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  blocks?: Array<{ type: string; text?: string; name?: string; skillId?: string }>;
  model?: string;
  modelConfig?: {
    modelName?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  context?: Record<string, string>;
};

type TurnResponse = {
  ok: boolean;
  sessionId: string;
  taskId: string;
  assistant: {
    text: string;
    cards: MessageCard[];
  };
  stepLogs: Array<{ step: string; status: "success" | "error" | "running"; message: string }>;
  errorCode?: string;
  message?: string;
};

type StepLog = {
  kind?: "phase" | "tool" | "note";
  step: string;
  status: "success" | "error" | "running";
  message: string;
  phaseId?: "understand" | "plan" | "execute" | "reflect" | "other";
  toolName?: string;
  latencyMs?: number;
  errorCode?: string;
  inputPreview?: string;
  outputPreview?: string;
  traceId?: string;
};

function isHermesCallIdToken(value: string | undefined): boolean {
  return /^call_[a-z0-9]+$/i.test((value ?? "").trim());
}

/** 将 function_call_output 的 call_id 对齐到同轮 function_call 的人类可读工具名。 */
function resolveToolNameForCallId(collected: StepLog[], callId: string): string | undefined {
  const id = callId.trim();
  if (!id) return undefined;
  for (let i = collected.length - 1; i >= 0; i--) {
    const s = collected[i]!;
    if (s.traceId !== id) continue;
    const name = (s.toolName ?? "").trim();
    if (name && !isHermesCallIdToken(name)) return name;
    const step = (s.step ?? "").trim();
    if (step && !isHermesCallIdToken(step)) return step;
  }
  return undefined;
}

function finalizeStepLogsForClient(logs: StepLog[]): StepLog[] {
  return dedupeToolStepsByTraceId(logs) as StepLog[];
}

type ToolCallPart = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallPart[] }
  | { role: "tool"; tool_call_id: string; content: string };

type SessionState = Record<string, ChatMessage[]>;

declare global {
  var __chatSessionState: SessionState | undefined;
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function resolveChatEndpoint(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
}

function getSessionStore() {
  if (!globalThis.__chatSessionState) {
    globalThis.__chatSessionState = {};
  }
  return globalThis.__chatSessionState;
}

const DEFAULT_CHAT_SYSTEM = "你是企业任务执行助手。请直接、准确回答，并在需要时给出可执行下一步。";

function getOrCreateSessionMessages(sessionId: string) {
  const store = getSessionStore();
  if (!store[sessionId]) {
    store[sessionId] = [
      {
        role: "system",
        content: DEFAULT_CHAT_SYSTEM,
      },
    ];
  }
  return store[sessionId];
}

function finalizeWizardAssistant(
  text: string,
  cards: MessageCard[],
  body: TurnRequest,
  skillLoad?: HermesTurnSkillLoadResult | null,
): { text: string; cards: MessageCard[] } {
  if (!isDatasourceWizardRequest(body, skillLoad ?? null)) {
    return { text, cards };
  }
  const { displayText, form } = parseWizardDbPayload(text);
  if (!form) {
    return { text: displayText, cards };
  }
  const record = formToDatasourceRecord(form, randomUUID());
  return {
    text: displayText.trim() || "数据源信息已解析，可在下方确认并保存到数据中心。",
    cards: [...cards, { type: "datasource_draft", payload: { record } }],
  };
}

function applyWizardToTurnResponse(
  resp: TurnResponse,
  body: TurnRequest,
  skillLoad?: HermesTurnSkillLoadResult | null,
): TurnResponse {
  const fin = finalizeWizardAssistant(resp.assistant.text, resp.assistant.cards, body, skillLoad ?? null);
  return {
    ...resp,
    assistant: { text: fin.text, cards: fin.cards },
  };
}

function turnHasInjectedSystem(body: TurnRequest, skillLoad: HermesTurnSkillLoadResult) {
  const hasSkillMd = !!skillLoad.combinedMarkdown?.trim();
  return (
    isDataRuleAuditWizardRequest(body, skillLoad) ||
    isDatasourceWizardRequest(body, skillLoad) ||
    hasSkillMd
  );
}

function resolveTurnSystemContent(body: TurnRequest, skillLoad: HermesTurnSkillLoadResult): string {
  const auditMode = isDataRuleAuditWizardRequest(body, skillLoad);
  const datasourceWizardMode = isDatasourceWizardRequest(body, skillLoad);
  const skillMd = skillLoad.combinedMarkdown?.trim() || null;
  if (auditMode && skillMd) {
    return `${skillMd}\n\n---\n\n${DATA_RULE_AUDIT_WIZARD_SYSTEM_PROMPT}`;
  }
  if (auditMode) {
    return DATA_RULE_AUDIT_WIZARD_SYSTEM_PROMPT;
  }
  if (datasourceWizardMode && skillMd) {
    return `${skillMd}\n\n---\n\n${DATASOURCE_DB_WIZARD_SYSTEM_PROMPT}`;
  }
  if (datasourceWizardMode) {
    return DATASOURCE_DB_WIZARD_SYSTEM_PROMPT;
  }
  if (skillMd) {
    return skillMd;
  }
  return DEFAULT_CHAT_SYSTEM;
}

function buildOpenAiStyleMessages(
  normalizedHistory: Array<{ role: "user" | "assistant"; content: string }>,
  userText: string,
  body: TurnRequest,
  skillLoad: HermesTurnSkillLoadResult,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (!turnHasInjectedSystem(body, skillLoad)) {
    return [...normalizedHistory, { role: "user", content: userText }];
  }
  return [
    { role: "system", content: resolveTurnSystemContent(body, skillLoad) },
    ...normalizedHistory,
    { role: "user", content: userText },
  ];
}

function buildHermesConversationHistory(
  normalizedHistory: Array<{ role: "user" | "assistant"; content: string }>,
  body: TurnRequest,
  skillLoad: HermesTurnSkillLoadResult,
): Array<{ role: string; content: string }> {
  if (!turnHasInjectedSystem(body, skillLoad)) {
    return normalizedHistory;
  }
  return [{ role: "system", content: resolveTurnSystemContent(body, skillLoad) }, ...normalizedHistory];
}

function toStepLogsFromToolCalls(toolCalls: unknown) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((item) => {
      const call = item as {
        name?: string;
        tool_name?: string;
        status?: "success" | "error" | "running";
        result?: unknown;
        message?: string;
      };
      const toolName = call.name || call.tool_name || "tool";
      const message =
        call.message ||
        (typeof call.result === "string"
          ? call.result
          : call.result
            ? JSON.stringify(call.result).slice(0, 120)
            : "工具调用已完成");
      return {
        step: toolName,
        status: call.status || "success",
        message,
      };
    })
    .filter((item) => !!item.step);
}

function parseSsePayloadChunk(buffer: string) {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;
  let idx = rest.indexOf("\n\n");
  while (idx !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const lines = block.split("\n");
    let event = "message";
    const dataLines: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length) {
      events.push({ event, data: dataLines.join("\n") });
    }
    idx = rest.indexOf("\n\n");
  }
  return { events, rest };
}

function tryJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeHermesBaseCandidates(endpoint?: string) {
  const candidates = new Set<string>();
  if (endpoint?.trim()) {
    const raw = endpoint.trim().replace(/\/+$/, "");
    if (raw.includes("/v1/")) {
      const base = raw.split("/v1/")[0];
      candidates.add(`${base}/v1`);
    } else if (raw.endsWith("/v1")) {
      candidates.add(raw);
    } else {
      candidates.add(`${raw}/v1`);
    }
  }
  const gw = process.env.HERMES_GATEWAY_URL?.trim();
  if (gw) {
    const root = gw.replace(/\/+$/, "");
    candidates.add(`${root}/v1`);
  }
  for (const b of defaultHermesV1Bases()) {
    candidates.add(b);
  }
  return [...candidates];
}

function toExecutionPlanCard(plan: unknown): MessageCard[] {
  if (Array.isArray(plan) && plan.every((x) => typeof x === "string")) {
    return [{ type: "execution_plan", payload: { steps: plan as string[] } }];
  }
  if (typeof plan === "string") {
    const steps = plan
      .split(/\n|。|；|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length) return [{ type: "execution_plan", payload: { steps } }];
  }
  if (plan && typeof plan === "object") {
    const candidate = (plan as { steps?: unknown; plan?: unknown }).steps ?? (plan as { plan?: unknown }).plan;
    if (Array.isArray(candidate) && candidate.every((x) => typeof x === "string")) {
      return [{ type: "execution_plan", payload: { steps: candidate as string[] } }];
    }
  }
  return [];
}

function toStepLogsFromPhases(data: Record<string, unknown>) {
  const phaseMap: Array<{ key: string; step: string }> = [
    { key: "thinking", step: "thinking" },
    { key: "analysis", step: "analysis" },
    { key: "plan", step: "plan" },
    { key: "execution", step: "execution" },
    { key: "reflect", step: "reflect" },
    { key: "reflection", step: "reflection" },
  ];

  const logs: Array<{ step: string; status: "success" | "error" | "running"; message: string }> = [];
  for (const { key, step } of phaseMap) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      logs.push({ step, status: "success", message: value.trim() });
      continue;
    }
    if (Array.isArray(value)) {
      const text = value.map((item) => String(item).trim()).filter(Boolean).join("；");
      if (text) logs.push({ step, status: "success", message: text });
    }
  }
  return logs;
}

function stepFromPhaseEvent(
  phase: string,
  status: "success" | "error" | "running",
  message: string,
  phaseId: StepLog["phaseId"] = "other",
): StepLog {
  return {
    kind: "phase",
    step: phase,
    status,
    message,
    phaseId,
  };
}

function toCompactText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim();
}

/** Hermes SSE `response.failed` 的 payload 形状因网关版本而异，避免仅读 error.message 导致用户只看到泛化失败文案 */
function hermesResponseFailedMessage(failPayload: Record<string, unknown> | undefined): string {
  if (!failPayload || typeof failPayload !== "object") {
    return "Hermes 响应执行失败（网关未返回失败载荷）";
  }
  const errRaw = failPayload.error;
  if (typeof errRaw === "string" && errRaw.trim()) {
    return errRaw.trim().replace(/\s+/g, " ").slice(0, 2000);
  }
  if (errRaw && typeof errRaw === "object") {
    const e = errRaw as Record<string, unknown>;
    const msg =
      (typeof e.message === "string" && e.message.trim() && e.message) ||
      (typeof e.msg === "string" && e.msg.trim() && e.msg) ||
      (typeof e.description === "string" && e.description.trim() && e.description) ||
      "";
    const code = e.code ?? e.status ?? e.type;
    if (msg) {
      const codeStr = code != null ? String(code).trim() : "";
      const suffix =
        codeStr && !msg.includes(codeStr) && codeStr !== "Error" ? `（${codeStr}）` : "";
      return `${msg}${suffix}`.replace(/\s+/g, " ").trim().slice(0, 2000);
    }
    if (code != null && String(code).trim()) {
      return `Hermes 错误：${String(code)}`.slice(0, 2000);
    }
  }
  const top =
    (typeof failPayload.message === "string" && failPayload.message.trim() && failPayload.message) ||
    (typeof failPayload.reason === "string" && failPayload.reason.trim() && failPayload.reason) ||
    (typeof failPayload.detail === "string" && failPayload.detail.trim() && failPayload.detail) ||
    "";
  if (top) return top.replace(/\s+/g, " ").trim().slice(0, 2000);
  try {
    const s = JSON.stringify(failPayload);
    if (s && s !== "{}") return s.length > 800 ? `${s.slice(0, 800)}…` : s;
  } catch {
    /* ignore */
  }
  return "Hermes 响应执行失败（未返回错误详情，请检查网关或 Hermes 服务日志后重试）";
}

function toDisplayText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  // Preserve line breaks for markdown/table readability in final answer text.
  return value.replace(/\r\n/g, "\n").trim();
}

/** OpenAI/Hermes chat.completion.chunk 中 choices[0].delta 的文本（含多模态 content 数组与 reasoning 字段） */
function extractOpenAiDeltaText(delta: Record<string, unknown> | undefined): string {
  if (!delta) return "";
  const c = delta.content;
  if (typeof c === "string" && c) return c.replace(/\r\n/g, "\n");
  if (Array.isArray(c)) {
    return (c as Array<{ text?: string }>)
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
  }
  const r = delta.reasoning_content;
  if (typeof r === "string" && r.trim()) return r.replace(/\r\n/g, "\n");
  const rp = (delta as { reasoning?: string }).reasoning;
  if (typeof rp === "string" && rp.trim()) return rp.replace(/\r\n/g, "\n");
  return "";
}

function toReadablePreview(value: unknown, limit = STEP_LOG_PREVIEW_MAX) {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const text = toCompactText(value);
    if (!text) return undefined;
    if (text.length > limit * 4) {
      return truncateProcessText(text, limit, "预览已截断");
    }
    try {
      const parsed = JSON.parse(text);
      const normalized = JSON.stringify(parsed);
      return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
    } catch {
      return text.length > limit ? `${text.slice(0, limit)}...` : text;
    }
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return undefined;
    if (serialized.length > limit * 4) {
      return truncateProcessText(serialized, limit, "预览已截断");
    }
    return serialized.length > limit ? `${serialized.slice(0, limit)}...` : serialized;
  } catch {
    return undefined;
  }
}

/** 写入 stepLogs / SSE 的过程文案：禁止把 MinerU 等整段正文塞进 message */
function toStepLogMessage(value: unknown, fallback: string, limit = STEP_LOG_MESSAGE_MAX): string {
  const preview = toReadablePreview(value, Math.min(limit, STEP_LOG_PREVIEW_MAX));
  if (preview) return preview;
  const compact = toCompactText(value, "");
  if (!compact) return fallback;
  return truncateProcessText(compact, limit, "过程文案已截断") ?? fallback;
}

function normalizeHermesResponse(data: Record<string, unknown>, fallbackSessionId: string): TurnResponse | null {
  const sessionId = (data.sessionId as string) || (data.session_id as string) || fallbackSessionId;
  const taskId = (data.taskId as string) || (data.task_id as string) || makeId("task");
  const assistantObj = data.assistant as { text?: string; content?: string; cards?: MessageCard[] } | undefined;
  const textCandidates = [
    assistantObj?.text,
    assistantObj?.content,
    data.message as string,
    data.reply as string,
    data.output as string,
  ].filter((x): x is string => typeof x === "string" && !!x.trim());
  const assistantText = textCandidates[0] ?? "";

  let cards: MessageCard[] = [];
  if (assistantObj?.cards && Array.isArray(assistantObj.cards)) {
    cards = assistantObj.cards;
  } else {
    cards = [
      ...toExecutionPlanCard(data.plan),
      ...toExecutionPlanCard(data.execution_plan),
      ...toExecutionPlanCard((data.assistant as { plan?: unknown } | undefined)?.plan),
    ];
  }

  const stepLogsRaw = data.stepLogs ?? data.step_logs;
  const stepLogsFromPayload = Array.isArray(stepLogsRaw)
    ? (stepLogsRaw as Array<{ step: string; status: "success" | "error" | "running"; message: string }>)
    : [];
  const stepLogsFromTools = toStepLogsFromToolCalls(data.tool_calls ?? data.tools);
  const stepLogsFromPhases = toStepLogsFromPhases(data);
  const stepLogs = stepLogsFromPayload.length
    ? stepLogsFromPayload
    : stepLogsFromPhases.length
      ? stepLogsFromPhases
      : stepLogsFromTools;

  if (!assistantText && !cards.length && !stepLogs.length) return null;
  return {
    ok: true,
    sessionId,
    taskId,
    assistant: {
      text: assistantText || "任务执行完成。",
      cards,
    },
    stepLogs,
  };
}

async function callModelDirectly(
  body: TurnRequest,
  sessionId: string,
  skillLoad: HermesTurnSkillLoadResult,
): Promise<TurnResponse> {
  const modelName = body.modelConfig?.modelName?.trim() || "";
  const baseUrl = body.modelConfig?.baseUrl?.trim() || "";
  const apiKey = body.modelConfig?.apiKey?.trim() || "";
  if (!modelName || !baseUrl || !apiKey) {
    throw new Error("MODEL_CONFIG_MISSING");
  }

  const sessionMessages = getOrCreateSessionMessages(sessionId);
  const systemContent = resolveTurnSystemContent(body, skillLoad);
  if (sessionMessages[0]?.role === "system") {
    sessionMessages[0] = { role: "system", content: systemContent };
  } else {
    sessionMessages.unshift({ role: "system", content: systemContent });
  }
  sessionMessages.push({ role: "user", content: body.text || "" });

  const endpoint = resolveChatEndpoint(baseUrl);
  const useWizardTools = isDatasourceWizardRequest(body, skillLoad);
  const tools = useWizardTools ? getDatasourceWizardChatTools() : undefined;

  let finalText = "";
  for (let iter = 0; iter < 8; iter++) {
    const reqBody: Record<string, unknown> = {
      model: modelName,
      messages: sessionMessages,
      stream: false,
    };
    if (tools?.length) {
      reqBody.tools = tools;
      reqBody.tool_choice = "auto";
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MODEL_CALL_FAILED:${response.status}:${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error("MODEL_EMPTY_RESPONSE");
    }
    const rawCalls = message.tool_calls;
    if (Array.isArray(rawCalls) && rawCalls.length > 0) {
      const normalizedCalls = rawCalls
        .filter((tc) => tc && typeof tc.id === "string")
        .map((tc) => ({
          id: tc.id as string,
          type: "function" as const,
          function: {
            name: String(tc.function?.name ?? "").trim(),
            arguments: String(tc.function?.arguments ?? "{}"),
          },
        }));
      if (!normalizedCalls.length) {
        throw new Error("MODEL_EMPTY_RESPONSE");
      }
      sessionMessages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: normalizedCalls,
      });
      for (const tc of normalizedCalls) {
        const out = await executeDatasourceWizardTool(tc.function.name, tc.function.arguments);
        sessionMessages.push({ role: "tool", tool_call_id: tc.id, content: out });
      }
      continue;
    }
    finalText = (typeof message.content === "string" ? message.content : "").trim();
    if (!finalText) {
      throw new Error("MODEL_EMPTY_RESPONSE");
    }
    sessionMessages.push({ role: "assistant", content: finalText });
    break;
  }
  if (!finalText) {
    throw new Error("MODEL_EMPTY_RESPONSE");
  }

  return applyWizardToTurnResponse(
    {
      ok: true,
      sessionId,
      taskId: makeId("task"),
      assistant: {
        text: finalText,
        cards: [],
      },
      stepLogs: [],
    },
    body,
    skillLoad,
  );
}

async function tryHermesStream(
  requestBody: TurnRequest,
  sessionId: string,
  skillLoad: HermesTurnSkillLoadResult,
) {
  const hermesEndpoint = process.env.HERMES_TURN_ENDPOINT?.trim();
  const hermesKey = process.env.API_SERVER_KEY?.trim() || process.env.HERMES_API_KEY?.trim();
  const authHeaders: Record<string, string> = hermesKey ? { Authorization: `Bearer ${hermesKey}` } : {};

  const controller = new AbortController();
  /** 仅约束「建立 SSE 连接」阶段；读流阶段见 streamFromHermesUpstream 的空闲/总时长 */
  const connectMs = hermesStreamConnectTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), connectMs);
  try {
    const normalizedHistory = Array.isArray(requestBody.conversationHistory)
      ? requestBody.conversationHistory
          .filter(
            (item): item is { role: "user" | "assistant"; content: string } =>
              !!item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string",
          )
          .map((item) => ({ role: item.role, content: item.content.trim() }))
          .filter((item) => item.content.length > 0)
      : [];
    const hermesChatMessages = buildOpenAiStyleMessages(
      normalizedHistory,
      requestBody.text || "",
      requestBody,
      skillLoad,
    );
    const hermesConvHistory = buildHermesConversationHistory(normalizedHistory, requestBody, skillLoad);
    const xingyanLlm = buildXingyanUserLlmFields(requestBody);
    const hermesModelId = hermesOpenAiModelField(requestBody);

    if (hermesEndpoint) {
      const response = await fetch(hermesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Hermes-Session-Id": sessionId,
          ...authHeaders,
        },
        body: JSON.stringify({
          ...requestBody,
          ...xingyanLlm,
          sessionId,
          stream: true,
          messages: hermesChatMessages,
          conversation_history: hermesConvHistory,
        }),
        signal: controller.signal,
      });
      if (response.ok && response.body) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream")) return response;
      }
    }

    for (const baseV1 of normalizeHermesBaseCandidates(hermesEndpoint)) {
      const responsesResp = await fetch(`${baseV1}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Hermes-Session-Id": sessionId,
          ...authHeaders,
        },
        body: JSON.stringify({
          model: hermesModelId,
          input: requestBody.text || "",
          conversation_history: hermesConvHistory,
          stream: true,
          ...xingyanLlm,
        }),
        signal: controller.signal,
      });
      if (responsesResp.ok && responsesResp.body) {
        const ct = responsesResp.headers.get("content-type") || "";
        if (ct.includes("text/event-stream")) return responsesResp;
      }

      const chatResp = await fetch(`${baseV1}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Hermes-Session-Id": sessionId,
          ...authHeaders,
        },
        body: JSON.stringify({
          model: hermesModelId,
          messages: hermesChatMessages,
          stream: true,
          session_id: sessionId,
          ...xingyanLlm,
        }),
        signal: controller.signal,
      });
      if (chatResp.ok && chatResp.body) {
        const ct = chatResp.headers.get("content-type") || "";
        if (ct.includes("text/event-stream")) return chatResp;
      }

      const startResp = await fetch(`${baseV1}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          input: requestBody.text || "",
          conversation_history: hermesConvHistory,
          session_id: sessionId,
          model: Object.keys(xingyanLlm).length ? hermesModelId : requestBody.model || "auto",
          metadata: { source: "frontend-bff" },
          ...xingyanLlm,
        }),
        signal: controller.signal,
      });
      if (!startResp.ok) continue;

      const startData = (await startResp.json()) as { run_id?: string };
      if (!startData.run_id) continue;

      const eventsResp = await fetch(`${baseV1}/runs/${startData.run_id}/events`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...authHeaders,
        },
        signal: controller.signal,
      });
      if (!eventsResp.ok || !eventsResp.body) continue;
      const contentType = eventsResp.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) continue;
      return eventsResp;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTurnResponse(
  body: TurnRequest,
  sessionId: string,
  skillLoad: HermesTurnSkillLoadResult,
): Promise<TurnResponse> {
  const hermesEndpoint = process.env.HERMES_TURN_ENDPOINT?.trim();
  if (hermesEndpoint) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(hermesEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, sessionId }),
        signal: controller.signal,
      });
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const normalized = normalizeHermesResponse(data, sessionId);
        if (normalized) {
          return normalized;
        }
      }
    } catch {
      // fall through to direct model mode
    } finally {
      clearTimeout(timeout);
    }
  }
  if (requiresHermesGatewayForSkillTurn(body)) {
    if (hasUsableModelConfig(body) && allowSkillDirectModelFallback()) {
      try {
        return await callModelDirectly(body, sessionId, skillLoad);
      } catch (e) {
        const msg = e instanceof Error ? e.message.trim() : String(e);
        return {
          ok: false,
          sessionId,
          taskId: makeId("task"),
          assistant: { text: "", cards: [] },
          stepLogs: [{ step: "model", status: "error", message: msg || "MODEL_DIRECT_FALLBACK_FAILED" }],
          errorCode: "MODEL_DIRECT_FALLBACK_FAILED",
          message: msg ? `技能会话直连模型失败：${msg}` : "技能会话直连模型失败",
        };
      }
    }
    return turnResponseHermesRequiredForSkill(sessionId);
  }
  return callModelDirectly(body, sessionId, skillLoad);
}

function hasUsableModelConfig(body: TurnRequest) {
  return !!body.modelConfig?.modelName?.trim() && !!body.modelConfig?.baseUrl?.trim() && !!body.modelConfig?.apiKey?.trim();
}

/**
 * Hermes 侧会把 `base_url` 与 `/v1/chat/completions` 再拼接；若用户在平台里填了完整
 * `.../v1/chat/completions` 或 `.../chat/completions`，会变成 404「…/chat/completions/chat/completions」。
 */
function normalizeXingyanUserLlmBaseUrlForHermes(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  for (;;) {
    const low = u.toLowerCase();
    if (low.endsWith("/v1/chat/completions")) {
      u = u.slice(0, u.length - "/v1/chat/completions".length).replace(/\/+$/, "");
      continue;
    }
    if (low.endsWith("/chat/completions")) {
      u = u.slice(0, u.length - "/chat/completions".length).replace(/\/+$/, "");
      continue;
    }
    break;
  }
  return u;
}

/** 供 Hermes `api_server` 解析：在已 Bearer 鉴权前提下，用平台配置的 Base URL / Key / 模型名覆盖本轮推理端点 */
function buildXingyanUserLlmFields(
  body: TurnRequest,
): { xingyan_user_llm: { base_url: string; api_key: string; model: string } } | Record<string, never> {
  if (!hasUsableModelConfig(body)) return {};
  const mc = body.modelConfig!;
  return {
    xingyan_user_llm: {
      base_url: normalizeXingyanUserLlmBaseUrlForHermes(mc.baseUrl!.trim()),
      api_key: mc.apiKey!.trim(),
      model: mc.modelName!.trim(),
    },
  };
}

function hermesOpenAiModelField(body: TurnRequest): string {
  const mc = body.modelConfig?.modelName?.trim();
  if (mc) return mc;
  const m = body.model?.trim();
  if (m && m !== "自动") return m;
  return "hermes-agent";
}

/** 开发联调：无 Hermes 时仍允许技能/向导会话走直连模型（须请求携带 modelConfig）。生产勿开启。 */
function allowSkillDirectModelFallback() {
  const v = process.env.ALLOW_SKILL_DIRECT_MODEL_FALLBACK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 底部快捷「新技能/配置数据源」或输入区技能卡片：须走 Hermes 流式推理，禁止直连模型兜底 */
function requiresHermesGatewayForSkillTurn(body: TurnRequest): boolean {
  if (isDatasourceWizardRequest(body, null)) return true;
  const blocks = body.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((raw) => {
    const b = raw as { type?: string; name?: string; skillId?: string };
    if (!b || b.type !== "skill_card") return false;
    return !!(b.name?.trim() || b.skillId?.trim());
  });
}

const HERMES_REQUIRED_FOR_SKILL_MESSAGE =
  "技能与数据源向导会话必须通过 Hermes 网关执行；当前未能建立 Hermes 流式连接。请在 Next 服务端环境配置 HERMES_GATEWAY_URL（例如 http://127.0.0.1:8642）或 HERMES_TURN_ENDPOINT；若 Next 跑在 Docker 内而 Gateway 在宿主机，可尝试 http://host.docker.internal:8642。并检查 API_SERVER_KEY/HERMES_API_KEY 与 Hermes 内 inference provider（如 hermes model）。默认已关闭直连模型兜底。仅本地联调可在 `.env.local` 设置 ALLOW_SKILL_DIRECT_MODEL_FALLBACK=1，并在对话中选用已配置的模型（携带 modelConfig），方可临时直连。";

function turnResponseHermesRequiredForSkill(sessionId: string): TurnResponse {
  return {
    ok: false,
    sessionId,
    taskId: makeId("task"),
    assistant: { text: "", cards: [] },
    stepLogs: [
      {
        step: "hermes",
        status: "error",
        message: HERMES_REQUIRED_FOR_SKILL_MESSAGE,
      },
    ],
    errorCode: "HERMES_REQUIRED_FOR_SKILL",
    message: HERMES_REQUIRED_FOR_SKILL_MESSAGE,
  };
}

function sseSkillHermesRequiredFailure(sessionId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let seq = 0;
      const pack = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ seq: ++seq, source: "bff", ...data })}\n\n`),
        );
      };
      pack("meta", { sessionId });
      pack("turn.failed", { message: HERMES_REQUIRED_FOR_SKILL_MESSAGE, retryableError: true });
      controller.close();
    },
  });
  /** 使用 200：部分浏览器/代理对「SSE + 非 2xx」会中断连接并表现为 fetch「Failed to fetch」；失败语义由 event turn.failed 承载。 */
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function isHermesProviderMissingError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("no inference provider configured") || normalized.includes("run 'hermes model'");
}

function streamFromHermesUpstream(
  upstream: Response,
  fallbackSessionId: string,
  requestBody: TurnRequest,
  skillLoad: HermesTurnSkillLoadResult,
  /** 含附件路径注入的正文，供直连模型兜底；向导解析仍用 requestBody（原始用户正文） */
  modelTurnBody?: TurnRequest,
) {
  const bodyForModel = modelTurnBody ?? requestBody;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 0;
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ seq: ++seq, source: "hermes", ...(data as object) })}\n\n`),
        );
      };

      writeEvent("meta", { sessionId: fallbackSessionId });

      const reader = upstream.body?.getReader();
      if (!reader) {
        writeEvent("error", { message: "Hermes 流读取失败" });
        controller.close();
        return;
      }

      let buffer = "";
      const collectedStepLogs: StepLog[] = [];
      let collectedText = "";
      let taskId = makeId("task");
      const toolCallStartEmitted = new Set<string>();
      const functionCallItemStartEmitted = new Set<string>();
      const streamStartedAt = Date.now();
      const idleMs = hermesStreamIdleTimeoutMs();
      const maxMs = hermesStreamMaxDurationMs();
      const heartbeatMs = hermesSseClientHeartbeatMs();
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
      };
      heartbeatTimer = setInterval(() => {
        const elapsedMs = Date.now() - streamStartedAt;
        const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
        writeEvent("turn.heartbeat", {
          elapsedMs,
          message: `Hermes 仍在执行（已 ${elapsedSec} 秒，可能含 MinerU 解析或多轮工具调用）…`,
        });
      }, heartbeatMs);

      try {
        while (true) {
          const { done, value } = await readStreamChunkWithIdleTimeout(
            reader,
            idleMs,
            streamStartedAt,
            maxMs,
          );
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSsePayloadChunk(buffer);
          buffer = parsed.rest;

          for (const evt of parsed.events) {
            const payload = tryJson(evt.data);
            const eventName =
              evt.event === "message" && typeof payload?.event === "string"
                ? payload.event
                : evt.event;

          if (eventName === "hermes.tool.progress") {
            const toolName =
              toCompactText(payload?.tool) ||
              toCompactText(payload?.name) ||
              "tool";
            const traceId =
              toCompactText(payload?.trace_id) ||
              toCompactText(payload?.call_id) ||
              toCompactText(payload?.callId) ||
              undefined;
            if (traceId && collectedStepLogs.some((s) => s.traceId === traceId && s.status === "running")) {
              continue;
            }
            const label = toCompactText(payload?.label) || `我正在执行工具「${toolName}」。`;
            const step: StepLog = {
              kind: "tool",
              step: toolName,
              toolName,
              status: "running",
              message: label,
              traceId,
            };
            collectedStepLogs.push(step);
            writeEvent("tool.started", {
              name: toolName,
              status: "running",
              detail: label,
              traceId,
            });
            continue;
          }

          if (eventName === "response.output_text.delta") {
            const delta = toDisplayText(payload?.delta);
            if (delta) {
              collectedText += delta;
              writeEvent("text.delta", { delta });
            }
            continue;
          }

          if (eventName === "response.output_item.added") {
            const item = payload?.item as Record<string, unknown> | undefined;
            const itemType = toCompactText(item?.type);
            if (itemType === "function_call") {
              const toolName = toCompactText(item?.name) || "tool";
              const callId = toCompactText(item?.call_id);
              const emitKey = callId ? `${callId}:${toolName}` : "";
              if (emitKey && functionCallItemStartEmitted.has(emitKey)) {
                continue;
              }
              if (emitKey) functionCallItemStartEmitted.add(emitKey);
              const step: StepLog = {
                kind: "tool",
                step: toolName,
                toolName,
                status: "running",
                message: `我开始调用工具「${toolName}」，正在准备参数。`,
                inputPreview: toReadablePreview(item?.arguments),
                traceId: callId || undefined,
              };
              collectedStepLogs.push(step);
              writeEvent("tool.started", {
                name: toolName,
                status: "running",
                detail: step.message,
                inputPreview: step.inputPreview,
                traceId: step.traceId,
              });
              continue;
            }
            if (itemType === "function_call_output") {
              const outputPreview =
                toReadablePreview(item?.output) || toReadablePreview(item?.content);
              const callId = toCompactText(item?.call_id);
              const resolvedToolName = resolveToolNameForCallId(collectedStepLogs, callId) || callId || "tool";
              const step: StepLog = clampStepLogFields({
                kind: "tool",
                step: resolvedToolName,
                toolName: resolvedToolName,
                status: "success",
                message: toStepLogMessage(
                  item?.output ?? item?.content,
                  "工具已返回结果。",
                ),
                outputPreview: outputPreview || undefined,
                traceId: callId || undefined,
              });
              collectedStepLogs.push(step);
              writeEvent("tool.completed", {
                name: resolvedToolName,
                status: "success",
                detail: step.message,
                outputPreview: step.outputPreview,
                traceId: step.traceId,
              });
              continue;
            }
          }

          if (eventName === "response.failed") {
            const failPayload = payload as Record<string, unknown>;
            const message = hermesResponseFailedMessage(failPayload);
            let failPreview = "";
            try {
              const s = JSON.stringify(failPayload);
              failPreview = s.length > 2500 ? `${s.slice(0, 2500)}…` : s;
            } catch {
              failPreview = "[unserializable]";
            }
            console.warn("[api/chat/turn] Hermes response.failed", message, failPreview);
            writeEvent("turn.failed", { message, retryableError: true });
            controller.close();
            return;
          }

          if (eventName === "response.completed") {
            const responseObj = payload?.response as Record<string, unknown> | undefined;
            const output = responseObj?.output as Array<Record<string, unknown>> | undefined;
            const finalFromResponse = Array.isArray(output)
              ? output
                  .flatMap((item) => {
                    const content = item?.content as Array<Record<string, unknown>> | undefined;
                    if (!Array.isArray(content)) return [];
                    return content
                      .map((part) =>
                        toDisplayText(part?.text) || toDisplayText(part?.output_text) || toDisplayText(part?.content),
                      )
                      .filter(Boolean);
                  })
                  .join("\n")
                  .trim()
              : "";
            const fallbackText =
              toDisplayText(payload?.output_text) ||
              toDisplayText(responseObj?.output_text) ||
              toDisplayText(responseObj?.text) ||
              toDisplayText(payload?.text);
            const finalText = finalFromResponse || fallbackText || collectedText;
            const fin = finalizeWizardAssistant(finalText, [], requestBody, skillLoad);
            writeEvent("turn.completed", {
              sessionId: fallbackSessionId,
              taskId,
              assistant: { text: fin.text, cards: fin.cards },
              stepLogs: finalizeStepLogsForClient(collectedStepLogs),
            });
            controller.close();
            return;
          }

          if (eventName === "message.delta") {
            const delta = typeof payload?.delta === "string" ? payload.delta : typeof payload?.text === "string" ? payload.text : "";
            if (delta) {
              collectedText += delta;
              writeEvent("text.delta", { delta });
            }
            continue;
          }

          const isOpenAiChoicesChunk =
            !!payload &&
            Array.isArray(payload.choices) &&
            (eventName === "message" ||
              eventName === "chat.completion.chunk" ||
              (typeof payload.object === "string" && String(payload.object).includes("chat.completion.chunk")));

          if (isOpenAiChoicesChunk) {
            const choices = payload!.choices as Array<{ delta?: Record<string, unknown> }> | undefined;
            const d0 = choices?.[0]?.delta;
            const out = extractOpenAiDeltaText(d0);
            if (out) {
              collectedText += out;
              writeEvent("text.delta", { delta: out });
            }
            const toolCalls = d0?.tool_calls as
              | Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>
              | undefined;
            if (Array.isArray(toolCalls)) {
              for (const tc of toolCalls) {
                const nm = typeof tc.function?.name === "string" ? tc.function.name.trim() : "";
                if (!nm) continue;
                const callId = typeof tc.id === "string" ? tc.id.trim() : "";
                const key = `${callId}:${nm}`;
                if (toolCallStartEmitted.has(key)) continue;
                toolCallStartEmitted.add(key);
                const preview = toReadablePreview(tc.function?.arguments);
                const step: StepLog = {
                  kind: "tool",
                  step: nm,
                  toolName: nm,
                  status: "running",
                  message: `模型正在调用工具「${nm}」…`,
                  inputPreview: preview,
                  traceId: callId || undefined,
                };
                collectedStepLogs.push(step);
                writeEvent("tool.started", {
                  name: nm,
                  status: "running",
                  detail: step.message,
                  inputPreview: preview,
                  traceId: callId || undefined,
                });
              }
            }
            continue;
          }

          if (eventName === "reasoning.available") {
            const message =
              toCompactText(payload?.summary) ||
              toCompactText(payload?.reasoning) ||
              toCompactText(payload?.detail) ||
              toCompactText(payload?.message);
            if (!message) {
              continue;
            }
            const step = stepFromPhaseEvent("thinking", "running", message, "understand");
            collectedStepLogs.push(step);
            writeEvent("reasoning.delta", { message: step.message, phaseId: step.phaseId, traceId: step.traceId });
            writeEvent("step", { step });
            continue;
          }

          if (eventName === "tool.started") {
            const toolName =
              (typeof payload?.tool_name === "string" && payload.tool_name) ||
              (typeof payload?.name === "string" && payload.name) ||
              "tool";
            const step: StepLog = {
              kind: "tool",
              step: toolName,
              toolName,
              status: "running",
              message:
                toCompactText(payload?.preview) ||
                toCompactText(payload?.message) ||
                `我开始执行工具「${toolName}」，正在处理输入参数。`,
              inputPreview:
                toReadablePreview(payload?.input_preview) || toReadablePreview(payload?.arguments),
              traceId:
                (typeof payload?.trace_id === "string" && payload.trace_id) ||
                (typeof payload?.run_id === "string" && payload.run_id) ||
                undefined,
            };
            collectedStepLogs.push(step);
            writeEvent("tool.started", {
              name: toolName,
              status: "running",
              detail: step.message,
              inputPreview: step.inputPreview,
              traceId: step.traceId,
            });
            continue;
          }

          if (eventName === "tool.completed") {
            const toolName =
              (typeof payload?.tool_name === "string" && payload.tool_name) ||
              (typeof payload?.name === "string" && payload.name) ||
              "tool";
            const step: StepLog = clampStepLogFields({
              kind: "tool",
              step: toolName,
              toolName,
              status: "success",
              message: toStepLogMessage(
                payload?.result_preview ?? payload?.message ?? payload?.result,
                `工具「${toolName}」已完成并返回结果。`,
              ),
              latencyMs:
                (typeof payload?.latency_ms === "number" && payload.latency_ms) ||
                (typeof payload?.duration_ms === "number" && payload.duration_ms) ||
                undefined,
              outputPreview:
                toReadablePreview(payload?.result_preview) || toReadablePreview(payload?.result),
              errorCode: typeof payload?.error_code === "string" ? payload.error_code : undefined,
              traceId:
                (typeof payload?.trace_id === "string" && payload.trace_id) ||
                (typeof payload?.run_id === "string" && payload.run_id) ||
                undefined,
            });
            collectedStepLogs.push(step);
            writeEvent("tool.completed", {
              name: toolName,
              status: "success",
              detail: step.message,
              latencyMs: step.latencyMs,
              outputPreview: step.outputPreview,
              errorCode: step.errorCode,
              traceId: step.traceId,
            });
            continue;
          }

          if (eventName === "run.completed") {
            taskId = (typeof payload?.run_id === "string" && payload.run_id) || taskId;
            const finalText =
              (typeof payload?.final_output === "string" && payload.final_output) ||
              (typeof payload?.text === "string" && payload.text) ||
              collectedText;
            const fin = finalizeWizardAssistant(finalText, [], requestBody, skillLoad);
            writeEvent("turn.completed", {
              sessionId: fallbackSessionId,
              taskId,
              assistant: { text: fin.text, cards: fin.cards },
              stepLogs: finalizeStepLogsForClient(collectedStepLogs),
            });
            controller.close();
            return;
          }

          if (eventName === "run.failed") {
            const reason =
              (typeof payload?.error === "string" && payload.error) ||
              (typeof payload?.message === "string" && payload.message) ||
              "Hermes run 执行失败";
            if (
              hasUsableModelConfig(requestBody) &&
              isHermesProviderMissingError(reason) &&
              !requiresHermesGatewayForSkillTurn(requestBody)
            ) {
              const fallback = await callModelDirectly(bodyForModel, fallbackSessionId, skillLoad);
              writeEvent("step", {
                step: {
                  kind: "phase",
                  step: "execute",
                  phaseId: "execute",
                  status: "running",
                  message: "Hermes 未配置 provider，已自动切换到系统模型直连执行。",
                },
              });
              for (const step of fallback.stepLogs) {
                writeEvent("step", { step });
              }
              if (fallback.assistant.text) {
                writeEvent("text.delta", { delta: fallback.assistant.text });
              }
              writeEvent("turn.completed", fallback);
              controller.close();
              return;
            }
            if (requiresHermesGatewayForSkillTurn(requestBody) && isHermesProviderMissingError(reason)) {
              writeEvent("turn.failed", {
                message: `${reason}。技能会话须在 Hermes 内配置 inference provider，已禁止直连模型兜底。`,
                retryableError: true,
              });
              controller.close();
              return;
            }
            writeEvent("step", {
              step: {
                kind: "phase",
                step: "execute",
                phaseId: "execute",
                status: "error",
                message: reason,
              },
            });
            writeEvent("turn.failed", { message: reason, retryableError: true });
            controller.close();
            return;
          }

          if (eventName === "error") {
            writeEvent("turn.failed", {
              message:
                (typeof payload?.message === "string" && payload.message) || "Hermes 执行异常",
              retryableError: true,
            });
            controller.close();
            return;
          }

          if (payload) {
            const normalized = normalizeHermesResponse(payload, fallbackSessionId);
            if (normalized) {
              writeEvent(
                "turn.completed",
                applyWizardToTurnResponse(normalized, requestBody, skillLoad),
              );
              controller.close();
              return;
            }
          }
        }
        }
      } catch (e) {
        stopHeartbeat();
        const msg = e instanceof Error ? e.message.trim() : String(e);
        writeEvent("turn.failed", {
          message: msg ? `Hermes 流读取异常：${msg}` : "Hermes 流读取异常",
          retryableError: true,
        });
        controller.close();
        return;
      } finally {
        stopHeartbeat();
      }

      const finTail = finalizeWizardAssistant(collectedText, [], requestBody, skillLoad);
      writeEvent("turn.completed", {
        sessionId: fallbackSessionId,
        taskId,
        assistant: { text: finTail.text, cards: finTail.cards },
        stepLogs: finalizeStepLogsForClient(collectedStepLogs),
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function streamFromTurnResponse(
  payload: TurnResponse,
  withModelFallbackTip = false,
  requestBody?: TurnRequest,
  skillLoad?: HermesTurnSkillLoadResult | null,
  directModelNote?: string,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 0;
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ seq: ++seq, source: withModelFallbackTip ? "model-direct" : "bff", ...(data as object) })}\n\n`,
          ),
        );
      };

      const out = requestBody ? applyWizardToTurnResponse(payload, requestBody, skillLoad ?? null) : payload;

      writeEvent("meta", { sessionId: out.sessionId, taskId: out.taskId });
      if (out.ok === false) {
        writeEvent("turn.failed", {
          message: out.message || "执行失败",
          retryableError: true,
        });
        controller.close();
        return;
      }
      if (withModelFallbackTip) {
        writeEvent("step", {
          step: {
            kind: "note",
            step: "direct_model",
            phaseId: "other",
            status: "success",
            message: directModelNote?.trim() || "当前为直连模型模式（无 Hermes 中间步骤）。",
          },
        });
      }
      for (const step of out.stepLogs) {
        writeEvent("step", { step });
      }
      if (out.assistant.text) {
        writeEvent("text.delta", { delta: out.assistant.text });
      }
      writeEvent("turn.completed", out);
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 单轮流式 Route 最长执行时间（秒）；自托管默认 2h，可用 CHAT_TURN_MAX_DURATION_SEC 覆盖 */
export const maxDuration = Number(process.env.CHAT_TURN_MAX_DURATION_SEC || 7200);

export async function POST(request: Request) {
  let body: TurnRequest;
  try {
    body = (await request.json()) as TurnRequest;
  } catch {
    return NextResponse.json(
      { ok: false, errorCode: "INVALID_JSON", message: "请求体须为合法 JSON" },
      { status: 400 },
    );
  }
  const baseText = (body.text ?? "").trim();
  const sessionId = body.sessionId || makeId("session");
  const attachmentSuffix = await buildHermesAttachmentDirectiveForBlocks(body.blocks);
  const skillLoad = await loadHermesSkillMarkdownForTurn(body.blocks);
  const stagingSuffix = await maybeBuildBaodanStagingSuffix(body, skillLoad);
  const hasVerifiedAttachments = attachmentSuffix.trim().length > 0;
  const hasStaging = stagingSuffix.trim().length > 0;
  if (!baseText && !hasVerifiedAttachments && !hasStaging) {
    return NextResponse.json(
      { ok: false, errorCode: "INVALID_INPUT", message: "请输入内容或上传已成功保存的附件" },
      { status: 400 },
    );
  }
  const upstreamBody: TurnRequest = { ...body, text: baseText + attachmentSuffix + stagingSuffix };

  try {
    const wantsStream = request.headers.get("accept")?.includes("text/event-stream");
    if (wantsStream) {
      const upstream = await tryHermesStream(upstreamBody, sessionId, skillLoad);
      if (upstream) {
        return streamFromHermesUpstream(upstream, sessionId, body, skillLoad, upstreamBody);
      }
      if (requiresHermesGatewayForSkillTurn(body)) {
        if (hasUsableModelConfig(body) && allowSkillDirectModelFallback()) {
          try {
            const response = await callModelDirectly(upstreamBody, sessionId, skillLoad);
            return streamFromTurnResponse(
              response,
              true,
              body,
              skillLoad,
              "技能会话：Hermes 流式不可用，已按 ALLOW_SKILL_DIRECT_MODEL_FALLBACK 使用当前所选模型直连（仅建议开发联调）；生产请启动网关并配置 HERMES_GATEWAY_URL。",
            );
          } catch (err) {
            const msg =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : "技能会话直连模型失败，请检查模型配置或启动 Hermes。";
            const encoder = new TextEncoder();
            const failStream = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode("event: turn.failed\n"));
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ message: msg, retryableError: true })}\n\n`),
                );
                controller.close();
              },
            });
            return new Response(failStream, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
              },
            });
          }
        }
        return sseSkillHermesRequiredFailure(sessionId);
      }
      if (hasUsableModelConfig(body)) {
        const response = await resolveTurnResponse(upstreamBody, sessionId, skillLoad);
        return streamFromTurnResponse(response, true, body, skillLoad);
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("event: turn.failed\n"));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                message:
                  "未检测到 Hermes 原生事件流，且当前未携带可用模型配置。请检查 HERMES_TURN_ENDPOINT 或在系统设置中配置模型。",
                retryableError: true,
              })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      /** 使用 200：避免 SSE 配 502 时客户端直接报 Failed to fetch；业务失败见 turn.failed。 */
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    const response = await resolveTurnResponse(upstreamBody, sessionId, skillLoad);
    if (response.ok === false && response.errorCode === "HERMES_REQUIRED_FOR_SKILL") {
      return NextResponse.json(response, { status: 503 });
    }
    return NextResponse.json(applyWizardToTurnResponse(response, body, skillLoad));
  } catch (error) {
    const wantsStream = request.headers.get("accept")?.includes("text/event-stream");
    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("event: turn.failed\n"));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                message:
                  error instanceof Error
                    ? `对话链路不可用：${error.message}。请先配置 Hermes Endpoint 或可用模型。`
                    : "对话链路不可用，请检查 Hermes 或模型配置。",
                retryableError: true,
              })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    return NextResponse.json(
      {
        ok: false,
        errorCode: "CHAT_RUNTIME_UNAVAILABLE",
        message:
          error instanceof Error
            ? `对话链路不可用：${error.message}。请先配置 Hermes Endpoint 或可用模型。`
            : "对话链路不可用，请检查 Hermes 或模型配置。",
      },
      { status: 502 },
    );
  }
}
