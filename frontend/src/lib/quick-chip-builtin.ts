import { dataRuleAuditBuiltin } from "@/components/skills/builtin-data-rule-audit";
import { datasourceWizardBuiltin } from "@/components/skills/builtin-datasource-wizard";
import { skillCreatorBuiltin } from "@/components/skills/builtin-skill-creator";
import type { Skill } from "@/components/skills/types";
import {
  displaySkillNameForUi,
  displaySkillSamplePromptForUi,
  type BuiltinQuickChipId,
} from "@/lib/skill-builtin-i18n";
import type { ContentBlock } from "@/components/chat/types";
import { hermesSkillIdCoversBuiltinSlug } from "@/lib/skills-ui-filter";

/** 与 `skillBuiltinList` / Hermes 目录名对齐 */
export const QUICK_CHIP_BUILTIN_SLUG: Record<
  BuiltinQuickChipId,
  "skill-creator-skill" | "datasource-wizard-skill" | "data-rule-audit-skill"
> = {
  datasource: "datasource-wizard-skill",
  "rule-audit": "data-rule-audit-skill",
  "new-skill": "skill-creator-skill",
};

export function builtinSkillForQuickChip(chip: BuiltinQuickChipId): Skill {
  if (chip === "rule-audit") return dataRuleAuditBuiltin;
  if (chip === "datasource") return datasourceWizardBuiltin;
  return skillCreatorBuiltin;
}

/** 药丸按钮文案、技能卡片展示名：与技能中心 `skill.builtin.*.name` 一致 */
export function getQuickChipSkillLabel(
  chip: BuiltinQuickChipId,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  return displaySkillNameForUi(builtinSkillForQuickChip(chip), t);
}

/** 药丸预填话术：与技能中心 `skill.builtin.*.samplePrompt` 一致 */
export function getQuickChipPrompt(
  chip: BuiltinQuickChipId,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  return displaySkillSamplePromptForUi(builtinSkillForQuickChip(chip), t).trim();
}

/** 用于 Hermes 目录匹配：当前语言展示名 + 内置 canonical 中文名 + 历史别名 */
export function quickChipMatchNames(
  chip: BuiltinQuickChipId,
  t: (key: string, vars?: Record<string, string>) => string,
): string[] {
  const builtin = builtinSkillForQuickChip(chip);
  const names = new Set<string>();
  const localized = displaySkillNameForUi(builtin, t).trim();
  const canonical = String(builtin.name ?? "").trim();
  if (localized) names.add(localized);
  if (canonical) names.add(canonical);
  if (chip === "new-skill") {
    names.add("skill-creator-skill");
    names.add("skill-creator");
  }
  return [...names];
}

export function skillCardDisplayName(
  skill: Skill,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  return displaySkillNameForUi(skill, t).trim() || String(skill.name ?? "").trim();
}

export function catalogIdTail(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split(":");
  return (parts.length > 1 ? parts[parts.length - 1]! : trimmed).trim();
}

export function pickHermesAlignedSkillForChip(
  catalog: Skill[],
  chip: BuiltinQuickChipId,
  t: (key: string, vars?: Record<string, string>) => string,
): Skill {
  const slug = QUICK_CHIP_BUILTIN_SLUG[chip];
  const matchNames = quickChipMatchNames(chip, t);
  const strict = catalog.find((s) => {
    const sid = String(s.id ?? "");
    if (hermesSkillIdCoversBuiltinSlug(sid, slug)) return true;
    if (catalogIdTail(sid) === slug) return true;
    if (matchNames.includes(String(s.name ?? "").trim())) return true;
    return false;
  });
  if (strict) return strict;
  if (chip === "new-skill") {
    const legacy = catalog.find((s) => {
      const sid = String(s.id ?? "");
      return catalogIdTail(sid) === "skill-creator" || s.name === "skill-creator";
    });
    if (legacy) return legacy;
    return skillCreatorBuiltin;
  }
  if (chip === "rule-audit") return dataRuleAuditBuiltin;
  return datasourceWizardBuiltin;
}

export function matchingQuickChipForHermesSkill(
  skill: Skill,
  t: (key: string, vars?: Record<string, string>) => string,
): BuiltinQuickChipId | null {
  const sid = String(skill.id ?? "");
  if (
    hermesSkillIdCoversBuiltinSlug(sid, "datasource-wizard-skill") ||
    catalogIdTail(sid).includes("datasource-wizard") ||
    quickChipMatchNames("datasource", t).includes(String(skill.name ?? "").trim())
  ) {
    return "datasource";
  }
  if (
    hermesSkillIdCoversBuiltinSlug(sid, "data-rule-audit-skill") ||
    catalogIdTail(sid).includes("data-rule-audit") ||
    quickChipMatchNames("rule-audit", t).includes(String(skill.name ?? "").trim())
  ) {
    return "rule-audit";
  }
  if (
    hermesSkillIdCoversBuiltinSlug(sid, "skill-creator-skill") ||
    catalogIdTail(sid) === "skill-creator-skill" ||
    quickChipMatchNames("new-skill", t).includes(String(skill.name ?? "").trim()) ||
    catalogIdTail(sid) === "skill-creator" ||
    skill.name === "skill-creator"
  ) {
    return "new-skill";
  }
  return null;
}

export function contentBlockMatchesQuickChip(
  b: ContentBlock,
  chip: BuiltinQuickChipId,
  t: (key: string, vars?: Record<string, string>) => string,
): boolean {
  if (b.type !== "skill_card") return false;
  const slug = QUICK_CHIP_BUILTIN_SLUG[chip];
  const sid = (b.skillId ?? "").trim();
  if (sid) {
    if (hermesSkillIdCoversBuiltinSlug(sid, slug)) return true;
    if (catalogIdTail(sid) === slug) return true;
    if (chip === "new-skill" && catalogIdTail(sid) === "skill-creator") return true;
    return false;
  }
  const name = String(b.name ?? "").trim();
  return quickChipMatchNames(chip, t).includes(name);
}
