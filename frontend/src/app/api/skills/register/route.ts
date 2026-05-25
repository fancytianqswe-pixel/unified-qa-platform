import { NextResponse } from "next/server";
import { postHermesRemoteSkillRegister } from "@/lib/hermes-skills-client";

export async function POST(request: Request) {
  const body = await request.json();
  const { name, description, scene, sessionId, taskId } = body ?? {};

  if (!name || !description || !scene) {
    return NextResponse.json(
      { ok: false, message: "name/description/scene 均为必填" },
      { status: 400 },
    );
  }

  const remote = await postHermesRemoteSkillRegister({
    name,
    description,
    scene,
    sessionId,
    taskId,
  });

  if (remote === null) {
    return NextResponse.json({
      ok: true,
      skillId: `skill_${Math.random().toString(36).slice(2, 10)}`,
      version: "1.0.0",
      message: "未配置 Hermes 网关地址（HERMES_GATEWAY_URL / HERMES_TURN_ENDPOINT）或专用注册 URL，使用本地兜底注册",
    });
  }

  return NextResponse.json({
    ok: remote.ok,
    skillId: remote.skillId,
    version: remote.version ?? "1.0.0",
    message:
      remote.message ??
      (remote.ok ? "已在 Hermes 技能目录创建" : "Hermes 注册未成功"),
  });
}
