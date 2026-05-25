/**
 * 将助手全文拆成「过程叙述」与「对用户最终结果」两段（启发式）。
 * Hermes 若未区分 channel，流式正文与工具事件在前端交错进 processTimeline，
 * 此处仅用于在出现明确 Markdown 章节标题时，把正文区收窄为「结果」部分。
 */
export type AssistantTextSplit = {
  /** 可能含推理、计划、工具间说明；展示在「已完成」过程时间线中已交错时，可不再整段重复在正文 */
  processMarkdown: string;
  /** 对用户展示的结论区；无可靠锚点时与全文相同 */
  resultMarkdown: string;
  /** 是否命中章节锚点（命中时 result 为从锚点起的子串） */
  usedHeadingAnchor: boolean;
};

const RESULT_HEADING_RES = [
  /\n##\s*审核报告\b/i,
  /\n##\s*最终(?:回复|结论|输出)\b/i,
  /\n##\s*总结\b/i,
  /\n##\s*答复\b/i,
  /^##\s*审核报告\b/im,
  /** 预警 / 汇报类：与数据规则审核等技能常见输出一致 */
  /\n##\s*(?:[⚠️✅❌🔔]\s*)*数据缺口预警?\b/i,
  /\n##\s*(?:[⚠️✅❌🔔]\s*)*关键发现\b/i,
  /\n##\s*审核结论\b/i,
  /** `## 📋 数据规则审核报告`、## 数据规则审核报告（阶段A）等：emoji/括号与「审核报告」之间可有任意非 # 换行片段 */
  /\n##\s*(?:[📋📌✅❌⚠️🔔]\s*)?[^#\n]{0,60}审核报告\b/i,
  /^##\s*(?:[📋📌✅❌⚠️🔔]\s*)?[^#\n]{0,60}审核报告\b/im,
  /\n##\s*审核前(?:的)?关键发现\b/i,
  /\n##\s*对(?:用户的)?(?:最终)?(?:输出|答复)\b/i,
  /^##\s*(?:[⚠️✅❌🔔]\s*)*数据缺口预警?\b/im,
  /^##\s*(?:[⚠️✅❌🔔]\s*)*关键发现\b/im,
  /\n---+[\t ]*\r?\n##\s+/,
  /** 数据规则审核等：模型常用 `#### ✅ 规则1—…` 作为结论块，此前未识别导致全文被当「过程」剥空 */
  /\n####\s*(?:[✅❌⚠️🔔]\s*)*规则/m,
  /\n###\s*审核(?:结果|结论|汇总)\b/i,
  /\n##\s*规则(?:审查|核验|检查|核对)\b/i,
  /\n##\s*阶段[ABCDE][^#\n]{0,20}(?:结果|结论|汇总)\b/i,
  /** `## 📋 阶段 A 审核报告` / `##📋阶段A审核报告` 等常见技能输出 */
  /\n##\s*[📋📌✅]?\s*阶段[ABCDE][^\n]{0,40}审核报告/i,
  /^##\s*[📋📌✅]?\s*阶段[ABCDE]/im,
];

export function splitAssistantProcessAndResult(fullText: string): AssistantTextSplit {
  const raw = fullText ?? "";
  if (!raw.trim()) {
    return { processMarkdown: "", resultMarkdown: "", usedHeadingAnchor: false };
  }
  let bestIdx = -1;
  for (const re of RESULT_HEADING_RES) {
    const m = raw.match(re);
    if (m && m.index != null && m.index >= 0) {
      if (bestIdx < 0 || m.index < bestIdx) bestIdx = m.index;
    }
  }
  if (bestIdx <= 0) {
    return { processMarkdown: raw, resultMarkdown: raw, usedHeadingAnchor: false };
  }
  const resultMarkdown = raw.slice(bestIdx).trimStart();
  const processMarkdown = raw.slice(0, bestIdx).trimEnd();
  return {
    processMarkdown,
    resultMarkdown: resultMarkdown || raw,
    usedHeadingAnchor: true,
  };
}
