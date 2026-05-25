import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAccessControlRuntimeState } from "@/lib/accessControlRuntime";
import { buildSessionAccess } from "@/lib/session-access";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session-token";

export const runtime = "nodejs";

export async function GET() {
  try {
    const jar = await cookies();
    const raw = jar.get(SESSION_COOKIE_NAME)?.value;
    const session = raw ? await verifySessionToken(raw) : null;
    if (!session) {
      return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });
    }
    const ac = getAccessControlRuntimeState();
    const access = buildSessionAccess(ac, session);
    return NextResponse.json({
      ok: true,
      user: {
        id: session.sub,
        account: session.account,
        name: session.name,
        role: session.role,
      },
      access,
    });
  } catch (err) {
    console.error("[api/auth/me]", err);
    return NextResponse.json({ ok: false, message: "服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
