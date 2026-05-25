import type { Skill } from "@/components/skills/types";

const DC: Skill["config"] = {
  url: "",
  sql: "",
  threshold: 0,
};

/** 正文由服务端经 `enrichSkillWithBundledMarkdown` 注入 `DATASOURCE_WIZARD_BUILTIN_MD` */
export const datasourceWizardBuiltin: Skill = {
  id: "datasource-wizard-skill",
  icon: "🗄️",
  name: "数据源配置助手",
  author: "平台",
  version: "1.0.0",
  source: "system",
  status: "published",
  rating: 4.8,
  usageCount: 0,
  description:
    "系统内置：多轮对话补齐八项参数后输出 hermes-datasource；草稿卡片内自动/手动完成连通性→（MySQL）字段与样例→保存到数据中心（localStorage）。直连模型下可选用探测类 function tools。",
  samplePrompt:
    "请使用【数据源配置助手】通过多轮对话协助我完成数据库数据源配置（名称、库类型、主机与端口、库名与表名、账号密码），信息齐备后输出可保存的配置。",
  params: [
    { key: "name", desc: "数据源显示名称", required: true },
    { key: "dbKind", desc: "mysql | postgresql | sqlserver | oracle | sqlite", required: true },
    { key: "host", desc: "主机或 IP", required: true },
    { key: "port", desc: "端口", required: true },
    { key: "database", desc: "数据库名", required: true },
    { key: "table", desc: "数据表名", required: true },
  ],
  config: DC,
  category: "通用工具",
  catalogSection: "办公提效",
  badgeLabel: "系统内置",
  listScope: "mine",
  mineKind: "platform",
  skillPolicy: "builtin",
  updatedAt: "2026-05-06",
};
