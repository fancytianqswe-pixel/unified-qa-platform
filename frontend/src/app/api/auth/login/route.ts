import { NextResponse } from "next/server";
import { getAccessControlRuntimeState } from "@/lib/accessControlRuntime";
import { verifyPasswordForUser } from "@/lib/password-auth";
import { SUPER_ADMIN_DISPLAY_NAME, SUPER_ADMIN_ROLE_NAME, SUPER_ADMIN_USER_ID } from "@/lib/platform-auth";
import { sessionCookieSecureFlag } from "@/lib/session-cookie-secure";
import { SESSION_COOKIE_NAME, signSessionPayload } from "@/lib/session-token";

export const runtime = "nodejs";

const MAX_AGE_SEC = 60 * 60 * 24 * 7;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "请求体须为 JSON" }, { status: 400 });
  }
  const u = (body as { username?: unknown; password?: unknown }).username;
  const p = (body as { username?: unknown; password?: unknown }).password;
  if (typeof u !== "string" || typeof p !== "string") {
    return NextResponse.json({ ok: false, message: "缺少用户名或密码" }, { status: 400 });
  }

  const username = u.trim();
  const password = p.trim();

  try {
    const ac = getAccessControlRuntimeState();
    const row = ac.users.find((x) => x.account === username);
    if (!row?.passwordHash || !verifyPasswordForUser(password, row.passwordHash)) {
      return NextResponse.json({ ok: false, message: "账号或密码错误" }, { status: 401 });
    }

    if (row.id === SUPER_ADMIN_USER_ID && row.role !== SUPER_ADMIN_ROLE_NAME) {
      return NextResponse.json(
        { ok: false, message: "权限数据中超级管理员角色不一致，请联系管理员修复「用户与权限」配置" },
        { status: 403 },
      );
    }

    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
    const token = await signSessionPayload({
      sub: row.id,
      account: row.account,
      name: row.name || (row.id === SUPER_ADMIN_USER_ID ? SUPER_ADMIN_DISPLAY_NAME : row.account),
      role: row.role,
      exp,
    });

    const res = NextResponse.json({
      ok: true,
      user: { id: row.id, account: row.account, name: row.name, role: row.role },
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SEC,
      secure: sessionCookieSecureFlag(request),
    });
    return res;
  } catch (err) {
    console.error("[api/auth/login]", err);
    return NextResponse.json({ ok: false, message: "登录服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
