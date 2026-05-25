import type { Skill } from "@/components/skills/types";
import { isSkillCreatorSkillId, normalizeSkillCreatorDisplayName } from "@/lib/skill-creator-display";
import { normalizeSkillBadgeLabel } from "@/lib/skill-badge-label";
import { hermesSkillIdCoversBuiltinSlug } from "@/lib/skills-ui-filter";

export type BuiltinSkillSlug = "datasourceWizard" | "ruleAudit" | "skillCreator";

/** 新任务页底部药丸 id（与 `?workspacePreset=` 一致） */
export type BuiltinQuickChipId = "datasource" | "rule-audit" | "new-skill";

export function builtinSlugForQuickChip(chip: BuiltinQuickChipId): BuiltinSkillSlug {
  if (chip === "datasource") return "datasourceWizard";
  if (chip === "rule-audit") return "ruleAudit";
  return "skillCreator";
}

const BUILTIN_PREFIX: Record<BuiltinSkillSlug, string> = {
  datasourceWizard: "skill.builtin.datasourceWizard",
  ruleAudit: "skill.builtin.ruleAudit",
  skillCreator: "skill.builtin.skillCreator",
};

/**
 * 仅靠 `skillId` 判断是否为三条平台内置技能（与 Hermes `h{n}:…` 列表一致）。
 * 技能面板里的项常**没有** `skillPolicy`，不能依赖 `skillPolicy === "builtin"` 才翻译。
 */
export function getBuiltinSlugFromSkillId(skillId: string | undefined): BuiltinSkillSlug | null {
  const id = String(skillId ?? "").trim();
  if (!id) return null;
  if (isSkillCreatorSkillId(id)) return "skillCreator";
  if (hermesSkillIdCoversBuiltinSlug(id, "datasource-wizard-skill")) return "datasourceWizard";
  if (hermesSkillIdCoversBuiltinSlug(id, "data-rule-audit-skill")) return "ruleAudit";
  return null;
}

function builtinT(
  slug: BuiltinSkillSlug,
  part: "name" | "description" | "samplePrompt",
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  return t(`${BUILTIN_PREFIX[slug]}.${part}`);
}

export function displaySkillNameForUi(
  skill: Skill,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const slug = getBuiltinSlugFromSkillId(skill.id);
  if (slug) return builtinT(slug, "name", t);
  return normalizeSkillCreatorDisplayName(skill.name, skill.id);
}

export function displaySkillDescriptionForUi(
  skill: Skill,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const slug = getBuiltinSlugFromSkillId(skill.id);
  if (slug) return builtinT(slug, "description", t);
  return skill.description ?? "";
}

export function displaySkillSamplePromptForUi(
  skill: Skill,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const slug = getBuiltinSlugFromSkillId(skill.id);
  if (slug) return builtinT(slug, "samplePrompt", t);
  return skill.samplePrompt ?? "";
}

/** 角标：仅「系统内置 / Hermes」走词条；用户/市场的原文不翻译 */
export function displaySkillBadgeLabelForUi(
  rawBadge: string | undefined,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const normalized = normalizeSkillBadgeLabel(rawBadge) ?? rawBadge ?? "";
  const s = String(normalized).trim();
  if (s === "系统内置" || String(rawBadge ?? "").trim() === "Hermes") return t("skill.badge.builtin");
  return s;
}

export function displaySkillNameFromBlock(
  name: string,
  skillId: string | undefined,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const slug = getBuiltinSlugFromSkillId(skillId);
  if (slug) return builtinT(slug, "name", t);
  return normalizeSkillCreatorDisplayName(name, skillId);
}
