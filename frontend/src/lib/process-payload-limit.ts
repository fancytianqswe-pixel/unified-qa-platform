/**
 * 过程区 / stepLogs 字段长度上限，避免 MinerU 等大工具回包拖垮浏览器（JSON.parse、localStorage、React 渲染）。
 */
export const STEP_LOG_MESSAGE_MAX = 4_000;
export const STEP_LOG_PREVIEW_MAX = 2_000;
/** 展开区 prettify JSON 时允许处理的最大字符数 */
export const UI_JSON_PRETTIFY_MAX = 32_000;
/** 启发式归纳胶囊文案时扫描原文的上限 */
export const UI_HEURISTIC_SCAN_MAX = 48_000;

export function truncateProcessText(
  value: string | undefined,
  max: number,
  label = "已截断",
): string | undefined {
  if (value == null) return undefined;
  const t = String(value).trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…（${label}，原文约 ${t.length.toLocaleString()} 字）`;
}

export function clampStepLogFields<
  T extends {
    message?: string;
    inputPreview?: string;
    outputPreview?: string;
  },
>(log: T): T {
  return {
    ...log,
    message: truncateProcessText(log.message, STEP_LOG_MESSAGE_MAX) ?? log.message,
    inputPreview: truncateProcessText(log.inputPreview, STEP_LOG_PREVIEW_MAX),
    outputPreview: truncateProcessText(log.outputPreview, STEP_LOG_PREVIEW_MAX),
  };
}
