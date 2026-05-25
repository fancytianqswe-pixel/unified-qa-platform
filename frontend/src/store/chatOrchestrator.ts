"use client";

import { ChatMessage, MessageCard } from "@/components/chat/types";

type StepLogEvent = NonNullable<ChatMessage["stepLogs"]>[number];

type OrchestratorEvent =
  | { type: "meta"; sessionId?: string; taskId?: string; traceId?: string; source?: string }
  | { type: "text.delta"; delta: string; seq?: number; traceId?: string }
  | { type: "reasoning.delta"; message: string; phaseId?: StepLogEvent["phaseId"]; traceId?: string }
  | {
      type: "tool.started" | "tool.completed";
      name: string;
      detail?: string;
      latencyMs?: number;
      errorCode?: string;
      inputPreview?: string;
      outputPreview?: string;
      traceId?: string;
    }
  | { type: "step"; step: StepLogEvent }
  | { type: "turn.heartbeat"; message?: string; elapsedMs?: number }
  | {
      type: "turn.completed";
      assistant?: { text?: string; cards?: MessageCard[] };
      stepLogs?: StepLogEvent[];
      sessionId?: string;
      taskId?: string;
      traceId?: string;
    }
  | { type: "turn.failed"; message: string; traceId?: string; retryableError?: boolean };

function parseSseChunk(buffer: string) {
  const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
  const events: string[] = [];
  let rest = normalizedBuffer;
  let idx = rest.indexOf("\n\n");
  while (idx !== -1) {
    events.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
    idx = rest.indexOf("\n\n");
  }
  return { events, rest };
}

function explainFetchNetworkFailure(raw: string): string {
  if (raw !== "Failed to fetch" && !/^TypeError\b/i.test(raw)) {
    return raw;
  }
  return [
    "网络请求失败（Failed to fetch）。",
    "常见原因：① 本页域名/端口与正在跑的 Next 不一致或 dev 已崩溃；② 代理/VPN/浏览器插件拦截；③ F12→Network 里 POST /api/chat/turn 显示 (failed)/被重置；④ 技能向导依赖 Hermes 时网关未起（先看终端与 HERMES_GATEWAY_URL）。",
    `原始错误：${raw}`,
  ].join("");
}

export type StreamChatTurnResult = {
  /** 是否收到服务端 `turn.completed`（或兼容的 `done`）事件；为 false 表示连接提前结束，回合可能未完成 */
  sawTurnCompleted: boolean;
};

export async function streamChatTurn(
  body: Record<string, unknown>,
  onEvent: (event: OrchestratorEvent) => void,
): Promise<StreamChatTurnResult> {
  let sawTurnCompleted = false;
  let res: Response;
  try {
    res = await fetch("/api/chat/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message.trim() : String(e);
    throw new Error(explainFetchNetworkFailure(raw));
  }
  if (!res.body) {
    throw new Error("流式响应不可用：响应体为空");
  }
  const contentType = res.headers.get("content-type") || "";
  const isEventStream = contentType.includes("text/event-stream");
  if (!res.ok && !isEventStream) {
    const detail = (await res.text().catch(() => "")).trim();
    throw new Error(detail ? detail.slice(0, 400) : `对话接口 HTTP ${res.status}`);
  }

  let sseBuffer = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      const raw = e instanceof Error ? e.message.trim() : String(e);
      throw new Error(
        raw === "Failed to fetch" || /^TypeError\b/i.test(raw)
          ? `流式连接中断（${raw}）。多为服务端关闭、反向代理超时或网络切换；请查看运行 Next 的终端与 Network 中该请求是否提前结束。`
          : `流式读取失败：${raw}`,
      );
    }
    const { done, value } = chunk;
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(sseBuffer);
    sseBuffer = parsed.rest;

    for (const rawEvent of parsed.events) {
      const eventTypeMatch = rawEvent.match(/^event:\s*(.+)$/m);
      const dataMatch = rawEvent.match(/^data:\s*(.+)$/m);
      const eventType = eventTypeMatch?.[1]?.trim() || "message";
      const dataStr = dataMatch?.[1]?.trim();
      if (!dataStr) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (eventType === "meta") {
        onEvent({
          type: "meta",
          sessionId: payload.sessionId as string | undefined,
          taskId: payload.taskId as string | undefined,
          traceId: payload.traceId as string | undefined,
          source: payload.source as string | undefined,
        });
        continue;
      }

      if (eventType === "text.delta" || eventType === "text") {
        onEvent({
          type: "text.delta",
          delta: ((payload.delta as string) || "") as string,
          seq: payload.seq as number | undefined,
          traceId: payload.traceId as string | undefined,
        });
        continue;
      }

      if (eventType === "reasoning.delta") {
        onEvent({
          type: "reasoning.delta",
          message: ((payload.message as string) || "") as string,
          phaseId: payload.phaseId as StepLogEvent["phaseId"] | undefined,
          traceId: payload.traceId as string | undefined,
        });
        continue;
      }

      if (eventType === "tool.started" || eventType === "tool.completed" || eventType === "tool") {
        const normalizedType =
          eventType === "tool.completed" || payload.status === "success" ? "tool.completed" : "tool.started";
        onEvent({
          type: normalizedType,
          name: ((payload.name as string) || "tool") as string,
          detail: payload.detail as string | undefined,
          latencyMs: payload.latencyMs as number | undefined,
          errorCode: payload.errorCode as string | undefined,
          inputPreview: payload.inputPreview as string | undefined,
          outputPreview: payload.outputPreview as string | undefined,
          traceId: payload.traceId as string | undefined,
        });
        continue;
      }

      if (eventType === "step" || eventType === "phase") {
        const maybeStep = (payload.step as StepLogEvent | undefined) ?? (payload.phase as StepLogEvent | undefined);
        if (maybeStep?.step) {
          onEvent({ type: "step", step: maybeStep });
        }
        continue;
      }

      if (eventType === "turn.heartbeat") {
        onEvent({
          type: "turn.heartbeat",
          message: payload.message as string | undefined,
          elapsedMs: payload.elapsedMs as number | undefined,
        });
        continue;
      }

      if (eventType === "turn.completed" || eventType === "done") {
        sawTurnCompleted = true;
        onEvent({
          type: "turn.completed",
          assistant: payload.assistant as { text?: string; cards?: MessageCard[] } | undefined,
          stepLogs: payload.stepLogs as StepLogEvent[] | undefined,
          sessionId: payload.sessionId as string | undefined,
          taskId: payload.taskId as string | undefined,
          traceId: payload.traceId as string | undefined,
        });
        continue;
      }

      if (eventType === "turn.failed" || eventType === "error") {
        onEvent({
          type: "turn.failed",
          message: ((payload.message as string) || "流式执行失败") as string,
          traceId: payload.traceId as string | undefined,
          retryableError: payload.retryableError as boolean | undefined,
        });
        continue;
      }
    }
  }

  if (!res.ok && isEventStream) {
    throw new Error(`对话接口 HTTP ${res.status}（未收到 turn.failed 事件体）`);
  }

  return { sawTurnCompleted };
}
