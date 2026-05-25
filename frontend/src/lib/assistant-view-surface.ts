import type { ProcessTimelineEntry } from "@/components/chat/types";
import { splitAssistantProcessAndResult } from "@/lib/assistant-result-split";
import { stripDisclosedProcessNarrativePrefix } from "@/lib/process-timeline";

function timelineHasNarrative(timeline: ProcessTimelineEntry[] | undefined): boolean {
  return !!timeline?.some((e) => e.kind === "narrative" && e.text.trim());
}

/**
 * 回合结束时固化「面向用户的正文区」Markdown。
 * - 无 `processTimeline` 叙述块：返回 `undefined`，界面继续用全文 + 流式前缀剥离。
 * - 有叙述时间线：**不再**截取「末次工具之后」叙述尾段；对 **`text`** 做与过程区同源的前缀剥离（`stripDisclosedProcessNarrativePrefix`）后，再按章节锚点收窄 / 全文兜底（与流式条内正文策略一致）。
 */
export function computeAssistantViewMarkdownForCompletedTurn(
  fullText: string,
  processTimeline: ProcessTimelineEntry[] | undefined,
): string | undefined {
  if (!timelineHasNarrative(processTimeline)) return undefined;

  const raw = fullText ?? "";
  const fullTrim = raw.trim();
  const afterStrip = stripDisclosedProcessNarrativePrefix(raw, processTimeline).replace(/^\s+/, "");
  const strippedTrim = afterStrip.trim();

  const splitStripped = splitAssistantProcessAndResult(afterStrip);
  if (splitStripped.usedHeadingAnchor) {
    const rm = splitStripped.resultMarkdown.trim();
    if (rm) return splitStripped.resultMarkdown;
  }

  const splitFull = splitAssistantProcessAndResult(fullTrim);
  if (splitFull.usedHeadingAnchor) {
    const rm = splitFull.resultMarkdown.trim();
    if (rm) return splitFull.resultMarkdown;
  }

  if (!strippedTrim) {
    return fullTrim;
  }
  if (strippedTrim === fullTrim) {
    return fullTrim;
  }
  return strippedTrim;
}
