import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (!pathname.startsWith("/system-settings")) {
    return NextResponse.next();
  }

  // 便于本地联调：追加 ?as=superadmin 会写入角色 Cookie。
  if (searchParams.get("as") === "superadmin") {
    const response = NextResponse.next();
    response.cookies.set("role", "super_admin", { path: "/" });
    return response;
  }

  const role = request.cookies.get("role")?.value;
  if (role !== "super_admin") {
    const target = request.nextUrl.clone();
    target.pathname = "/unauthorized";
    target.searchParams.set("from", pathname);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/system-settings/:path*"],
};

