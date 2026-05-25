import { Skill } from "@/components/skills/types";
import { datasourceWizardBuiltin } from "@/components/skills/builtin-datasource-wizard";
import { dataRuleAuditBuiltin } from "@/components/skills/builtin-data-rule-audit";
import { skillCreatorBuiltin } from "@/components/skills/builtin-skill-creator";

/** 市场精选 — 分类筛选（首项「全部」仅用于 UI，不落库） */
export const SKILL_MARKET_CATEGORY_CHIPS = [
  "全部",
  "通用工具",
  "网络运维",
  "市场营销",
  "客户服务",
  "政企支撑",
  "计费结算",
  "数据分析",
  "安全合规",
] as const;

/** 用于新建技能等场景的默认分类区块名（界面不再单独展示该标题） */
export const SKILL_CATALOG_SECTION_DEFAULT = "办公提效";

/** 「我的技能」Tab 下：全部 / 平台内置 / 个人 */
export const SKILL_MINE_KIND_CHIPS = ["全部", "平台内置", "个人"] as const;

/**
 * 系统内置技能（始终优先出现在列表最前，且与 Hermes 返回结果按 id 去重合并时保留内置定义优先）。
 * 含：数据源配置助手、数据规则审核助手、技能创建助手（后者正文来自 bundles/skill-creator-skill/SKILL.md）。
 */
export const skillBuiltinList: Skill[] = [datasourceWizardBuiltin, dataRuleAuditBuiltin, skillCreatorBuiltin];

/**
 * Hermes 未配置时的额外兜底条目（默认可为空）；列表接口会将 **skillBuiltinList 置于最前**。
 */
export const skillMockList: Skill[] = [];

/**
 * 合并技能列表：顺序为 **内置 → mock 兜底 → 远端**，同 id 只保留先出现的项。
 */
export function mergeSkillLists(...groups: Skill[][]): Skill[] {
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const group of groups) {
    for (const s of group) {
      const id = String(s.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }
  }
  return out;
}
