/**
 * 系统内置「数据规则审核助手」详情页 SKILL v2.1 正文。
 * 源文件：`data-rule-audit-builtin-v2.md`（由 `enrichSkillWithBundledMarkdown` 在服务端读入并注入）。
 */
import fs from "node:fs";
import path from "node:path";

let cachedMarkdown: string | null = null;

function readBundledMarkdownFromDisk(): string {
  const abs = path.join(process.cwd(), "src", "components", "skills", "data-rule-audit-builtin-v2.md");
  return fs.readFileSync(abs, "utf8");
}

/** 供 API / 服务端注入；首次访问读盘并缓存 */
export function loadDataRuleAuditBuiltinMarkdown(): string {
  if (cachedMarkdown === null) {
    cachedMarkdown = readBundledMarkdownFromDisk();
  }
  return cachedMarkdown;
}

export const DATA_RULE_AUDIT_BUILTIN_MD = loadDataRuleAuditBuiltinMarkdown();
