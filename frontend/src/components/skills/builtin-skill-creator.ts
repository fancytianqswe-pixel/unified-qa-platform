import type { Skill } from "@/components/skills/types";
import { SKILL_CREATOR_DISPLAY_NAME } from "@/lib/skill-creator-display";

const DC: Skill["config"] = {
  url: "https://skills.internal/skill-creator",
  sql: "SELECT 1",
  threshold: 0.9,
};

/** 正文由服务端从 `bundles/skill-creator-skill/SKILL.md` 注入（见 `enrichSkillWithBundledMarkdown`） */
export const skillCreatorBuiltin: Skill = {
  id: "skill-creator-skill",
  icon: "📦",
  name: SKILL_CREATOR_DISPLAY_NAME,
  author: "平台",
  version: "1.0.0",
  source: "system",
  status: "published",
  rating: 4.9,
  usageCount: 0,
  description:
    "系统内置：支持创建、修订、评估、基准测试、优化描述与打包六种模式，将技能目录打包为可分发的 skill-creator-skill.zip（含 agents、scripts、references 等）。",
  samplePrompt:
    "请使用技能创建助手的「打包」模式，检查当前技能目录结构并说明 zip 内各目录职责。",
  params: [
    { key: "mode", desc: "工作模式：create | revise | evaluate | benchmark | optimize_description | package", required: false },
    { key: "task", desc: "自然语言任务说明", required: true },
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
