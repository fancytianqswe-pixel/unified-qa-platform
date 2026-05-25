import type { Skill } from "@/components/skills/types";

/** Hermes 列表项 id 是否对应「默认主目录」根（通常为 ~/.hermes/skills） */
export function isHermesDefaultHomeSkillId(skillId: string): boolean {
  return skillId.startsWith("h0:");
}

/**
 * 是否过滤掉 Hermes 主目录（h0）技能，仅展示 external_dirs 等后续根 + 本地合并项。
 * `SKILLS_UI_HIDE_HERMES_HOME=0` / `false` 显式关闭；其余默认开启（满足「前端不展示 Hermes 内置主目录技能」）。
 */
export function shouldHideHermesDefaultHomeSkills(): boolean {
  const raw = process.env.SKILLS_UI_HIDE_HERMES_HOME?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

export function filterHermesSkillsForUi<T extends { id?: string }>(remote: T[]): T[] {
  if (!shouldHideHermesDefaultHomeSkills()) return remote;
  return remote.filter((item) => !isHermesDefaultHomeSkillId(String(item.id ?? "")));
}

/** Hermes 返回的 h{n}:skill-creator-skill 与内置 slug skill-creator-skill 对齐 */
export function hermesSkillIdCoversBuiltinSlug(hermesId: string, builtinId: string): boolean {
  const id = String(hermesId ?? "").trim();
  const slug = String(builtinId ?? "").trim();
  if (!slug) return false;
  return id === slug || id.endsWith(`:${slug}`);
}

/** 当远端已有同 slug 的 Hermes 磁盘技能时，不再重复插入 TS 内置占位项 */
export function builtinsNotCoveredByRemote(builtins: Skill[], remote: Skill[]): Skill[] {
  return builtins.filter(
    (b) => !remote.some((r) => hermesSkillIdCoversBuiltinSlug(String(r.id ?? ""), String(b.id ?? ""))),
  );
}
