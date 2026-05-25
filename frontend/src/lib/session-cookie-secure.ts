/**
 * 是否应为会话 Cookie 设置 `Secure`。
 * 生产环境若一律 `secure: true`，在本地或内网用 **`http://` + `next start`** 时浏览器会丢弃 Set-Cookie，表现为「登录成功立刻掉线 / 无法登录」。
 * 仅在确认为 HTTPS 时启用（直连或常见反向代理 `x-forwarded-proto`）。
 */
export function sessionCookieSecureFlag(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const raw = request.headers.get("x-forwarded-proto");
  const first = raw?.split(",")[0]?.trim().toLowerCase();
  if (first === "https") return true;
  if (first === "http") return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
