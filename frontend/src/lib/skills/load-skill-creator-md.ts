import fs from "node:fs";
import path from "node:path";
import type { Skill } from "@/components/skills/types";
import { DATA_RULE_AUDIT_BUILTIN_MD } from "@/components/skills/data-rule-audit-builtin-md";
import { DATASOURCE_WIZARD_BUILTIN_MD } from "@/components/skills/datasource-wizard-builtin-md";
import { SKILL_CREATOR_FALLBACK_MD } from "@/components/skills/skill-creator-skill-md";
import { isSkillCreatorSkillId, SKILL_CREATOR_DISPLAY_NAME } from "@/lib/skill-creator-display";
import { hermesSkillIdCoversBuiltinSlug } from "@/lib/skills-ui-filter";

const SKILL_REL = ["src", "components", "skills", "bundles", "skill-creator-skill", "SKILL.md"] as const;

let cached: string | null = null;

function readFromDisk(): string | null {
  const abs = path.join(process.cwd(), ...SKILL_REL);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** 从仓库内已安装的 zip 解压副本读取 SKILL.md（仅服务端 / Route Handler 调用） */
export function loadSkillCreatorSkillMarkdown(): string {
  if (cached !== null) return cached;
  const raw = readFromDisk();
  if (raw) {
    cached = raw;
    return raw;
  }
  return SKILL_CREATOR_FALLBACK_MD;
}

export function enrichSkillWithBundledMarkdown(skill: Skill): Skill {
  if (isSkillCreatorSkillId(String(skill.id ?? ""))) {
    return {
      ...skill,
      name: SKILL_CREATOR_DISPLAY_NAME,
      badgeLabel: "系统内置",
      skillDocMarkdown: loadSkillCreatorSkillMarkdown(),
      skillPolicy: "builtin",
    };
  }
  if (hermesSkillIdCoversBuiltinSlug(skill.id, "datasource-wizard-skill")) {
    return {
      ...skill,
      badgeLabel: "系统内置",
      skillDocMarkdown: DATASOURCE_WIZARD_BUILTIN_MD,
      skillPolicy: "builtin",
    };
  }
  if (hermesSkillIdCoversBuiltinSlug(skill.id, "data-rule-audit-skill")) {
    return {
      ...skill,
      badgeLabel: "系统内置",
      skillDocMarkdown: DATA_RULE_AUDIT_BUILTIN_MD,
      skillPolicy: "builtin",
    };
  }
  return skill;
}
