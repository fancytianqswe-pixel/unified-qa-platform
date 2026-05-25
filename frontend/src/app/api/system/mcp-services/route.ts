import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  backendInsertMcpService,
  backendIsMcpNameTakenByOther,
  backendListMcpServices,
  getMcpPersistenceKind,
} from "@/lib/mcp-platform-backend";
import { validateMcpCreateBody } from "@/lib/mcp-services-validate";

function noBackendResponse() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "未配置持久化：请设置 PLATFORM_MYSQL_URL 或 PLATFORM_MYSQL_HOST + PLATFORM_MYSQL_USER + PLATFORM_MYSQL_DATABASE（可选密码/端口）。开发环境未配置时将自动使用项目根目录 `.platform-mcp-store.json`（见 .env.example）。",
    },
    { status: 503 },
  );
}

export async function GET() {
  const kind = getMcpPersistenceKind();
  if (!kind) return noBackendResponse();
  try {
    const list = await backendListMcpServices();
    return NextResponse.json({
      ok: true,
      list,
      persistence: kind,
      devFileStore: kind === "file",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "查询失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!getMcpPersistenceKind()) return noBackendResponse();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "请求体须为 JSON" }, { status: 400 });
  }
  const v = validateMcpCreateBody(json);
  if (!v.ok) return NextResponse.json({ ok: false, message: v.message }, { status: 400 });
  try {
    if (await backendIsMcpNameTakenByOther(v.data.name, null)) {
      return NextResponse.json({ ok: false, message: "名称已存在" }, { status: 409 });
    }
    const id = randomUUID();
    await backendInsertMcpService(id, v.data);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ ok: false, message: "名称已存在" }, { status: 409 });
    }
    const msg = err.message || "写入失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
