import { hermesSkillIdCoversBuiltinSlug } from "@/lib/skills-ui-filter";

/** 与目录 id `skill-creator-skill` 对应，全产品统一的展示名 */
export const SKILL_CREATOR_DISPLAY_NAME = "技能创建助手";

function catalogIdTail(id: string): string {
  const t = String(id ?? "").trim();
  if (!t) return "";
  const parts = t.split(":");
  return (parts.length > 1 ? parts[parts.length - 1]! : t).trim();
}

/** 是否为「技能创建助手」这一条（含 Hermes `h{n}:…` 与旧目录 `skill-creator`） */
export function isSkillCreatorSkillId(skillId: string): boolean {
  const sid = String(skillId ?? "").trim();
  if (!sid) return false;
  return (
    hermesSkillIdCoversBuiltinSlug(sid, "skill-creator-skill") ||
    hermesSkillIdCoversBuiltinSlug(sid, "skill-creator") ||
    catalogIdTail(sid) === "skill-creator-skill" ||
    catalogIdTail(sid) === "skill-creator"
  );
}

/** 列表、卡片、会话块等处：凡命中技能创建助手，一律展示中文名 */
export function normalizeSkillCreatorDisplayName(name: string, skillId?: string): string {
  const sid = (skillId ?? "").trim();
  if (sid && isSkillCreatorSkillId(sid)) return SKILL_CREATOR_DISPLAY_NAME;
  const n = (name || "").trim();
  if (n === "skill-creator-skill" || n === "skill-creator" || n === "Skill Creator") return SKILL_CREATOR_DISPLAY_NAME;
  return name;
}
