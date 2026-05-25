import type { Skill } from "@/components/skills/types";
import { mergeSkillLists, skillBuiltinList, skillMockList } from "@/components/skills/data";
import { hermesSkillIdCoversBuiltinSlug } from "@/lib/skills-ui-filter";

const MERGED_BUILTIN_AND_MOCK = mergeSkillLists(skillBuiltinList, skillMockList);

/**
 * 技能详情 id 常为 Hermes 形 `h1:datasource-wizard-skill`，与内置 `datasource-wizard-skill` 不一致。
 * 在远端无记录或失败时，用此函数匹配内置/mock 并保留 URL 中的 `id` 供界面一致。
 */
export function findBuiltinMockFallbackForDetailId(requestedId: string): Skill | null {
  const id = requestedId.trim();
  if (!id) return null;
  const direct = MERGED_BUILTIN_AND_MOCK.find((s) => s.id === id);
  if (direct) return direct;
  for (const b of MERGED_BUILTIN_AND_MOCK) {
    if (hermesSkillIdCoversBuiltinSlug(id, b.id)) {
      return { ...b, id };
    }
  }
  return null;
}
