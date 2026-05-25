import type { ChatMessage } from "@/components/chat/types";

function norm(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 从用户气泡拼出检索用语（含技能/文件卡片占位） */
export function userMessagePlainHint(m: ChatMessage): string {
  if (m.role !== "user") return "";
  if (m.blocks?.length) {
    return m.blocks
      .map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "skill_card") return `技能 ${b.name}`;
        if (b.type === "file_card") return `文件 ${b.name}`;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return m.text || "";
}

const GENERIC: readonly string[] = [
  "用三条要点概括你上一条的结论",
  "把上面最关键的风险单独展开说明",
  "如果我要复现同样流程，下一步具体该做什么？",
  "有没有需要我补充的上下文或数据？",
  "把结论整理成给业务同事看的要点清单",
];

const ERROR_RETRY: readonly string[] = [
  "刚才失败的主要原因是什么？给出可操作的修复步骤",
  "换一种更稳妥的做法再试一次，并说明差异",
  "列出我需要检查的配置项或环境依赖清单",
];

const DATASOURCE_SQL: readonly string[] = [
  "用表格总结当前查询/连接结果里的关键字段",
  "如果连接仍失败，逐项帮我排查主机端口与账号权限",
  "给一个最小可执行的验证 SQL 或请求示例",
];

const RULE_AUDIT: readonly string[] = [
  "审核结论里有哪些需要我优先处理？按优先级排序",
  "补充一条你认为尚未覆盖的规则或边界情况",
  "把发现的问题整理成可发给业务方的简短说明",
];

const MINIO_ATTACH: readonly string[] = [
  "MinIO 或附件拉取失败时，有哪些替代方案（例如本地上传）？",
  "说明桶策略、路径与凭证各自要解决什么问题",
  "用步骤清单说明如何在本环境里验证附件可读",
];

const SKILL: readonly string[] = [
  "这个技能在本仓库里对应哪些脚本或目录？",
  "列出该技能明确不做的事情（能力边界）",
  "给一个最小可复现的调用示例（含必要参数）",
];

function takeUnique(picks: string[], pool: readonly string[]) {
  for (const s of pool) {
    if (picks.length >= 3) return;
    if (!picks.includes(s)) picks.push(s);
  }
}

/**
 * 为每条已结束的助手回复生成 3 条「可能继续问」的快捷追问（启发式，可后续接模型或上游字段）。
 */
export function buildAssistantFollowUpChips(opts: {
  assistantPlain: string;
  lastUserPlain?: string;
}): [string, string, string] {
  const blob = norm(`${opts.lastUserPlain || ""} ${opts.assistantPlain || ""}`);
  const picks: string[] = [];

  if (/失败|错误|error|exception|traceback|无法|不能|拒接|refused|timeout|超时|127|exit code|退出码/i.test(blob)) {
    takeUnique(picks, ERROR_RETRY);
  }
  if (/minio|s3|附件|对象存储|桶|credential|凭证|presign|aws4/i.test(blob)) {
    takeUnique(picks, MINIO_ATTACH);
  }
  if (/审核|规则|报账|reimbursement|合规|缺口|预警/i.test(blob)) {
    takeUnique(picks, RULE_AUDIT);
  }
  if (/mysql|sql|数据源|连接|schema|表结构|查询|datasource|pymysql|端口/i.test(blob)) {
    takeUnique(picks, DATASOURCE_SQL);
  }
  if (/技能|skill|skill_|mcp|工具调用/i.test(blob)) {
    takeUnique(picks, SKILL);
  }
  takeUnique(picks, GENERIC);

  while (picks.length < 3) {
    takeUnique(picks, GENERIC);
  }
  return [picks[0]!, picks[1]!, picks[2]!];
}
