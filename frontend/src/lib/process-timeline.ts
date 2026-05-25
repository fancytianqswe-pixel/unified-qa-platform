import type { AssistantStepLog, ProcessTimelineEntry } from "@/components/chat/types";

function isCallIdStep(step: string | undefined) {
  return /^call_[a-z0-9]+$/i.test((step ?? "").trim());
}

export function isToolStepLog(log: AssistantStepLog): boolean {
  return log.kind === "tool" || !!(log.toolName?.trim());
}

function preferHumanToolName(name: string | undefined): string | undefined {
  const t = (name ?? "").trim();
  if (!t || isCallIdStep(t)) return undefined;
  return t;
}

/** 同一 traceId 的 started + completed（可不相邻）合并为一条最终 step。 */
export function mergeToolStepLogs(prev: AssistantStepLog, next: AssistantStepLog): AssistantStepLog {
  const nextStatus: AssistantStepLog["status"] =
    next.status === "error" ? "error" : next.status === "success" ? "success" : prev.status;
  const humanName =
    preferHumanToolName(next.toolName) ?? preferHumanToolName(prev.toolName) ?? next.toolName ?? prev.toolName;
  return {
    ...prev,
    ...next,
    status: nextStatus,
    step: isCallIdStep(next.step) ? prev.step : next.step || prev.step,
    toolName: humanName,
    message:
      next.status !== "running" && (next.message?.trim() ?? "")
        ? (next.message ?? "")
        : next.message?.trim()
          ? next.message
          : (prev.message ?? ""),
    inputPreview: prev.inputPreview || next.inputPreview,
    outputPreview: next.outputPreview || prev.outputPreview,
    latencyMs: next.latencyMs ?? prev.latencyMs,
    errorCode: next.errorCode || prev.errorCode,
    traceId: next.traceId || prev.traceId,
  };
}

/**
 * 按 traceId 全局合并工具步（保留首次出现位置），修复「started 与 completed 被 narrative 隔开」时
 * 顶部长期显示「进行中」的问题。
 */
export function dedupeToolStepsByTraceId(logs: AssistantStepLog[]): AssistantStepLog[] {
  const out: AssistantStepLog[] = [];
  const indexByTrace = new Map<string, number>();
  for (const log of logs) {
    if (!isToolStepLog(log)) {
      out.push({ ...log });
      continue;
    }
    const tid = log.traceId?.trim();
    if (!tid) {
      out.push({ ...log });
      continue;
    }
    const idx = indexByTrace.get(tid);
    if (idx === undefined) {
      indexByTrace.set(tid, out.length);
      out.push({ ...log });
    } else {
      out[idx] = mergeToolStepLogs(out[idx]!, log);
    }
  }
  return out;
}

export type TimelineFlatRow =
  | { kind: "narrative"; text: string }
  | { kind: "step"; log: AssistantStepLog };

/**
 * 展平后的行：同一 traceId 仅在首次出现处展示，状态/message 取全局合并结果。
 */
export function consolidateFlatTimelineToolSteps(rows: TimelineFlatRow[]): TimelineFlatRow[] {
  const finalByTrace = new Map<string, AssistantStepLog>();
  for (const row of rows) {
    if (row.kind !== "step") continue;
    const tid = row.log.traceId?.trim();
    if (!tid || !isToolStepLog(row.log)) continue;
    const prev = finalByTrace.get(tid);
    finalByTrace.set(tid, prev ? mergeToolStepLogs(prev, row.log) : { ...row.log });
  }
  const seenTrace = new Set<string>();
  const out: TimelineFlatRow[] = [];
  for (const row of rows) {
    if (row.kind === "narrative") {
      out.push(row);
      continue;
    }
    const tid = row.log.traceId?.trim();
    if (tid && isToolStepLog(row.log)) {
      if (seenTrace.has(tid)) continue;
      seenTrace.add(tid);
      out.push({ kind: "step", log: finalByTrace.get(tid)! });
      continue;
    }
    out.push(row);
  }
  return out;
}

/** 回合结束时压缩时间线：去掉重复 traceId 的 step，并写入合并后的最终状态。 */
export function collapseProcessTimelineToolSteps(timeline: ProcessTimelineEntry[]): ProcessTimelineEntry[] {
  const finalByTrace = new Map<string, AssistantStepLog>();
  for (const e of timeline) {
    if (e.kind !== "step") continue;
    const tid = e.log.traceId?.trim();
    if (!tid || !isToolStepLog(e.log)) continue;
    const prev = finalByTrace.get(tid);
    finalByTrace.set(tid, prev ? mergeToolStepLogs(prev, e.log) : { ...e.log });
  }
  const seen = new Set<string>();
  const out: ProcessTimelineEntry[] = [];
  for (const e of timeline) {
    if (e.kind === "narrative") {
      out.push(e);
      continue;
    }
    const tid = e.log.traceId?.trim();
    if (tid && isToolStepLog(e.log)) {
      if (seen.has(tid)) continue;
      seen.add(tid);
      out.push({ kind: "step", log: finalByTrace.get(tid)! });
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * 是否存在「工具调用」类过程步（非仅有正文流式叙述 / 纯 phase）。
 * 用于已结束回合：无工具步时不展示「已完成」折叠过程区，避免纯问答仍占一条过程带。
 */
export function assistantProcessHasToolSteps(
  timeline: ProcessTimelineEntry[] | undefined,
  stepLogs: AssistantStepLog[] | undefined,
): boolean {
  if (timeline?.length) {
    for (const e of timeline) {
      if (e.kind !== "step") continue;
      const log = e.log;
      if (log.kind === "tool" || (log.toolName?.trim() ?? "").length > 0) return true;
    }
  }
  if (stepLogs?.length) {
    return stepLogs.some((l) => l.kind === "tool" || (l.toolName?.trim() ?? "").length > 0);
  }
  return false;
}

export function appendNarrativeDelta(
  timeline: ProcessTimelineEntry[] | undefined,
  delta: string,
): ProcessTimelineEntry[] {
  if (!delta) return timeline ?? [];
  const base = timeline ?? [];
  const last = base[base.length - 1];
  if (last?.kind === "narrative") {
    return [...base.slice(0, -1), { kind: "narrative", text: last.text + delta }];
  }
  return [...base, { kind: "narrative", text: delta }];
}

export function appendStepToTimeline(
  timeline: ProcessTimelineEntry[] | undefined,
  log: AssistantStepLog,
): ProcessTimelineEntry[] {
  const base = timeline ?? [];
  return [...base, { kind: "step", log: { ...log } }];
}

/** 时间线中「最后一次工具类 step」的下标（`kind: tool` 或带 `toolName`）；无工具步时为 -1。 */
export function lastToolStepIndexInTimeline(timeline: ProcessTimelineEntry[] | undefined): number {
  if (!timeline?.length) return -1;
  let last = -1;
  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i]!;
    if (e.kind !== "step") continue;
    const log = e.log;
    const isTool = log.kind === "tool" || (log.toolName?.trim() ?? "").length > 0;
    if (isTool) last = i;
  }
  return last;
}

/**
 * 过程区 / 复制「过程全文」/ 前缀剥离用：去掉**末次工具调用之后**的 `narrative`。
 * 与 `extractNarrativeTailAfterLastStep` 同源分界；条内 Markdown 正文**不再**单独取该尾段，改走全文 + `stripDisclosedProcessNarrativePrefix`。
 */
export function omitNarrativesAfterLastToolStep(
  timeline: ProcessTimelineEntry[] | undefined,
): ProcessTimelineEntry[] {
  if (!timeline?.length) return timeline ?? [];
  const lastTool = lastToolStepIndexInTimeline(timeline);
  if (lastTool < 0) return [...timeline];
  return timeline.filter((e, i) => !(e.kind === "narrative" && i > lastTool));
}

/** 与过程区 UI、过程复制、步骤摘要任务同源：先去掉末次工具后的叙述再展平。 */
export function flattenTimelineForProcessArea(
  timeline: ProcessTimelineEntry[] | undefined,
): Array<{ kind: "narrative"; text: string } | { kind: "step"; log: AssistantStepLog }> {
  return flattenTimelineForDisplay(omitNarrativesAfterLastToolStep(timeline));
}

export function dedupeConsecutiveToolLogsInBuffer(logs: AssistantStepLog[]): AssistantStepLog[] {
  const out: AssistantStepLog[] = [];
  for (const log of logs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      isToolStepLog(prev) &&
      isToolStepLog(log) &&
      log.traceId &&
      prev.traceId &&
      log.traceId === prev.traceId
    ) {
      out[out.length - 1] = mergeToolStepLogs(prev, log);
    } else {
      out.push({ ...log });
    }
  }
  return out;
}

/**
 * 将「叙述块 + 工具块」展平：每个叙述块一行，连续 step 先合并再逐条输出。
 */
export function flattenTimelineForDisplay(timeline: ProcessTimelineEntry[]): Array<
  | { kind: "narrative"; text: string }
  | { kind: "step"; log: AssistantStepLog }
> {
  const rows: Array<{ kind: "narrative"; text: string } | { kind: "step"; log: AssistantStepLog }> = [];
  let stepBuf: AssistantStepLog[] = [];
  const flushSteps = () => {
    if (!stepBuf.length) return;
    for (const log of dedupeConsecutiveToolLogsInBuffer(stepBuf)) {
      rows.push({ kind: "step", log });
    }
    stepBuf = [];
  };
  for (const e of timeline) {
    if (e.kind === "narrative") {
      flushSteps();
      const t = e.text.replace(/\s+/g, " ").trim();
      if (t) rows.push({ kind: "narrative", text: e.text });
    } else {
      stepBuf.push(e.log);
    }
  }
  flushSteps();
  return consolidateFlatTimelineToolSteps(rows);
}

/**
 * 取「时间线中**最后一次工具调用**（`kind: tool` 或带 `toolName` 的 step）之后」拼接的所有 `narrative`。
 * **条内正文展示已不再使用**本函数；过程区仍用同源分界（`omitNarrativesAfterLastToolStep`）。保留便于排查或后续能力开关。
 */
export function extractNarrativeTailAfterLastStep(
  timeline: ProcessTimelineEntry[] | undefined,
): string | null {
  if (!timeline?.length) return null;
  const lastToolIdx = lastToolStepIndexInTimeline(timeline);
  if (lastToolIdx < 0) return null;
  let acc = "";
  for (let i = lastToolIdx + 1; i < timeline.length; i++) {
    const e = timeline[i]!;
    if (e.kind === "narrative") acc += e.text;
  }
  const t = acc.trim();
  return t.length > 0 ? t : null;
}

/**
 * 正文区去掉与「过程时间线」里叙述块已展示内容相同的前缀，避免上下重复。
 * 与过程区同源：经 `flattenTimelineForProcessArea` 后仅拼接**已展示在过程中**的叙述段文本。
 */
function collapseWsForPrefixCompare(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 去掉与时间线叙述拼接相同的前缀；先严格匹配，再按「空白折叠」容忍正文与流式块之间换行/空格差异。
 */
export function stripDisclosedProcessNarrativePrefix(
  fullText: string,
  timeline: ProcessTimelineEntry[] | undefined,
): string {
  if (!fullText || !timeline?.length) return fullText;
  const flat = flattenTimelineForProcessArea(timeline);
  const disclosed = flat
    .filter((r): r is { kind: "narrative"; text: string } => r.kind === "narrative")
    .map((r) => r.text)
    .join("");
  if (!disclosed) return fullText;
  const norm = (s: string) => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const f = norm(fullText);
  const d = norm(disclosed);
  if (f.length < d.length) return fullText;
  if (f.startsWith(d)) {
    return f.slice(d.length).replace(/^\s+/, "");
  }
  const fc = collapseWsForPrefixCompare(f);
  const dc = collapseWsForPrefixCompare(d);
  if (!dc || fc.length < dc.length || !fc.startsWith(dc)) return fullText;
  for (let k = 1; k <= f.length; k++) {
    const c = collapseWsForPrefixCompare(f.slice(0, k));
    if (c.length > dc.length) break;
    if (c === dc) {
      return f.slice(k).replace(/^\s+/, "");
    }
    if (c.length > 0 && !dc.startsWith(c)) break;
  }
  return fullText;
}
