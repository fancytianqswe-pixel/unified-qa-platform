import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session-token";

/** 去掉尾部 `/`（除根路径），避免 `/api/auth/login/` 未命中放行白名单导致 POST 登录被 401 */
function normalizePathname(pathname: string): string {
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function isPublicPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  if (p === "/") return true;
  if (p === "/api/auth/login") return true;
  if (p === "/api/auth/logout") return true;
  if (p === "/unauthorized") return true;
  if (p.startsWith("/_next")) return true;
  if (p.startsWith("/brand/")) return true;
  if (p === "/favicon.ico") return true;
  return false;
}

/** Hermes 网关在容器内 HTTP 调 Next 的 datasource BFF，无浏览器 Cookie（见 compose 中 DATASOURCE_MCP_BASE_URL） */
function isDatasourceBridgeApi(pathname: string): boolean {
  return pathname.startsWith("/api/datasource/");
}

export async function middleware(request: NextRequest) {
  try {
    const pathname = normalizePathname(request.nextUrl.pathname);
    /**
     * 会话探测改由 Node 上的 `GET /api/auth/me` 处理（与登录态 Cookie 验签同源），
     * 避免在 Edge middleware 内重复验签时因运行环境差异（Web Crypto / Cookie 形态）导致异常或异常耗时。
     */
    if (pathname === "/api/auth/me" && request.method === "GET") {
      return NextResponse.next();
    }
    if (isPublicPath(pathname) || isDatasourceBridgeApi(pathname)) {
      return NextResponse.next();
    }

    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = raw ? await verifySessionToken(raw) : null;
    if (!session) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ ok: false, message: "未登录或会话已失效" }, { status: 401 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  } catch (err) {
    console.error("[middleware]", err);
    const pathname = normalizePathname(request.nextUrl.pathname);
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, message: "服务暂时不可用，请稍后重试" },
        { status: 503 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: [
    "/new-task/:path*",
    "/skills-center/:path*",
    "/task-center/:path*",
    "/data-center/:path*",
    "/conversation/:path*",
    "/system-settings/:path*",
    "/api/:path*",
  ],
};
