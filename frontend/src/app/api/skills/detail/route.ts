import { NextResponse } from "next/server";
import type { Skill } from "@/components/skills/types";
import { enrichSkillWithBundledMarkdown } from "@/lib/skills/load-skill-creator-md";
import { fetchHermesRemoteSkillDetail } from "@/lib/hermes-skills-client";
import { findBuiltinMockFallbackForDetailId } from "@/lib/skills-detail-fallback";
import { normalizeSkillDetailRouteId } from "@/lib/skill-route-id";

function enrichDetail(skill: Skill | null): Skill | null {
  if (!skill) return null;
  return enrichSkillWithBundledMarkdown(skill);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("id")?.trim();
  const id = raw ? normalizeSkillDetailRouteId(raw) : "";
  if (!id) {
    return NextResponse.json({ ok: false, message: "id 为必填项" }, { status: 400 });
  }

  try {
    const localFallback = enrichDetail(findBuiltinMockFallbackForDetailId(id));

    const remote = await fetchHermesRemoteSkillDetail(id);
    if (remote === null) {
      return NextResponse.json({ ok: !!localFallback, skill: localFallback });
    }

    if (remote.skill) {
      return NextResponse.json({
        ok: true,
        skill: enrichDetail(remote.skill as Skill),
        ...(remote.message ? { message: remote.message } : {}),
      });
    }

    return NextResponse.json({
      ok: !!localFallback,
      skill: localFallback,
      message: remote.message
        ? `Hermes 未返回该技能（${remote.message}），已使用本地详情兜底`
        : "Hermes 未返回该技能，已使用本地详情兜底",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "服务器错误";
    const localFallback = enrichDetail(findBuiltinMockFallbackForDetailId(id));
    return NextResponse.json(
      {
        ok: !!localFallback,
        skill: localFallback,
        message: localFallback ? `详情接口异常已兜底：${msg}` : msg,
      },
      { status: localFallback ? 200 : 500 },
    );
  }
}
