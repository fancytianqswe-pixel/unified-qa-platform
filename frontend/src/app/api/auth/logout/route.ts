import { NextResponse } from "next/server";
import { sessionCookieSecureFlag } from "@/lib/session-cookie-secure";
import { SESSION_COOKIE_NAME } from "@/lib/session-token";

export async function POST(request: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: sessionCookieSecureFlag(request),
  });
  return res;
}
