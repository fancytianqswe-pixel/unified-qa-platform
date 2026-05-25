import { NextResponse } from "next/server";

type Body = { url?: string };

/**
 * 对远程 MCP（SSE / HTTP）端点做轻量可达性探测，不校验 MCP 协议正文。
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体须为 JSON" }, { status: 400 });
  }
  const url = String(body.url ?? "").trim();
  if (!url) return NextResponse.json({ ok: false, message: "url 必填" }, { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, message: "URL 无效" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ ok: false, message: "仅支持 http(s)" }, { status: 400 });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      redirect: "follow",
      headers: { Accept: "text/event-stream, application/json, */*" },
    });
    clearTimeout(timer);
    return NextResponse.json({
      ok: true,
      status: res.status,
      reachable: res.ok || res.status === 401 || res.status === 403 || res.status === 405,
      message:
        res.ok || res.status === 401 || res.status === 403
          ? "端点有响应（含需鉴权场景）"
          : res.status === 405
            ? "端点存在（405 常见于仅接受 POST/SSE）"
            : `HTTP ${res.status}`,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : "请求失败";
    return NextResponse.json({ ok: false, reachable: false, message: msg }, { status: 200 });
  }
}
