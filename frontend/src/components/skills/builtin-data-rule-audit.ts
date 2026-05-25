import type { Skill } from "@/components/skills/types";

const DC: Skill["config"] = {
  url: "",
  sql: "",
  threshold: 0,
};

/** 正文由服务端经 `enrichSkillWithBundledMarkdown` 注入 `DATA_RULE_AUDIT_BUILTIN_MD` */
export const dataRuleAuditBuiltin: Skill = {
  id: "data-rule-audit-skill",
  icon: "✅",
  name: "数据规则审核助手",
  author: "平台",
  version: "2.1.0",
  source: "system",
  status: "published",
  rating: 4.7,
  usageCount: 0,
  description:
    "系统内置 v2.1.0：先三问（数据源、规则、抽样/全量），按步骤 1～7 分步执行；阶段 A 固定 1 条，确认后阶段 B 逐条（至多 5 单，非并行）；MinerU 仅 parse_and_wait、每轮最多 2 次；附件走 BFF chat-uploads；只审用户给出的 N 条规则。",
  samplePrompt:
    "请用【数据规则审核助手】v2.1.0：Q1 数据源名称+表名；Q2 审核规则逐条原文；Q3 先跑一条还是阶段 B。规则示例：合同编号与付款通知书合同编号一致（共 4 条）。先做阶段 A。",
  params: [
    { key: "datasource", desc: "已配置数据源名称及库表", required: true },
    { key: "rules", desc: "审核规则（分条、可判定）", required: true },
    { key: "output", desc: "输出结构（可留空采用默认模板）", required: false },
  ],
  config: DC,
  category: "数据分析",
  catalogSection: "办公提效",
  badgeLabel: "系统内置",
  listScope: "mine",
  mineKind: "platform",
  skillPolicy: "builtin",
  updatedAt: "2026-05-19",
};
