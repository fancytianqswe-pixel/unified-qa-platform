import { NextResponse } from "next/server";
import type { Skill } from "@/components/skills/types";
import { enrichSkillWithBundledMarkdown } from "@/lib/skills/load-skill-creator-md";
import { mergeSkillLists, skillBuiltinList, skillMockList } from "@/components/skills/data";
import { fetchHermesRemoteSkillList } from "@/lib/hermes-skills-client";
import { builtinsNotCoveredByRemote, filterHermesSkillsForUi } from "@/lib/skills-ui-filter";

function enrichList(list: Skill[]): Skill[] {
  return list.map(enrichSkillWithBundledMarkdown);
}

/** 短缓存：减轻技能中心反复进入时的 Hermes 并行探测次数；SWR 在后台可继续用旧数据。 */
const LIST_CACHE_CONTROL = "public, max-age=12, s-maxage=12, stale-while-revalidate=120";

export async function GET() {
  const remoteResult = await fetchHermesRemoteSkillList();

  if (remoteResult === null) {
    const localOnly = enrichList(mergeSkillLists(skillBuiltinList, skillMockList));
    return NextResponse.json({ ok: true, list: localOnly }, { headers: { "Cache-Control": LIST_CACHE_CONTROL } });
  }

  const remoteRaw = Array.isArray(remoteResult.list) ? (remoteResult.list as Skill[]) : [];
  const remote = filterHermesSkillsForUi(remoteRaw);
  const extraBuiltins = builtinsNotCoveredByRemote(skillBuiltinList, remote);
  const merged = enrichList(mergeSkillLists(skillMockList, extraBuiltins, remote));

  if (!remoteRaw.length && remoteResult.message) {
    return NextResponse.json(
      {
        ok: true,
        list: merged,
        message: `Hermes 技能列表不可用：${remoteResult.message}，已使用本地列表兜底`,
      },
      { headers: { "Cache-Control": LIST_CACHE_CONTROL } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      list: merged,
      ...(remoteResult.message ? { message: remoteResult.message } : {}),
    },
    { headers: { "Cache-Control": LIST_CACHE_CONTROL } },
  );
}
