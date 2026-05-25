import { NextResponse } from "next/server";
import {
  backendDeleteMcpService,
  backendGetMcpServiceById,
  backendIsMcpNameTakenByOther,
  backendSetMcpServiceEnabled,
  backendUpdateMcpService,
  getMcpPersistenceKind,
} from "@/lib/mcp-platform-backend";
import { validateMcpCreateBody } from "@/lib/mcp-services-validate";

function noBackendResponse() {
  return NextResponse.json(
    { ok: false, message: "未配置平台持久化，无法操作 MCP 服务。请查看 .env.example。" },
    { status: 503 },
  );
}

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  if (!getMcpPersistenceKind()) return noBackendResponse();
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, message: "缺少 id" }, { status: 400 });
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "请求体须为 JSON" }, { status: 400 });
  }
  const v = validateMcpCreateBody(json);
  if (!v.ok) return NextResponse.json({ ok: false, message: v.message }, { status: 400 });
  try {
    const existing = await backendGetMcpServiceById(id);
    if (!existing) return NextResponse.json({ ok: false, message: "记录不存在" }, { status: 404 });
    if (v.data.name !== existing.name && (await backendIsMcpNameTakenByOther(v.data.name, id))) {
      return NextResponse.json({ ok: false, message: "名称已被其他记录占用" }, { status: 409 });
    }
    const n = await backendUpdateMcpService(id, v.data);
    if (n === 0) return NextResponse.json({ ok: false, message: "未更新任何行" }, { status: 404 });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ ok: false, message: "名称已存在" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: err.message || "更新失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!getMcpPersistenceKind()) return noBackendResponse();
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, message: "缺少 id" }, { status: 400 });
  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "请求体须为 JSON" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ ok: false, message: "enabled 须为布尔值" }, { status: 400 });
  }
  try {
    const n = await backendSetMcpServiceEnabled(id, body.enabled);
    if (n === 0) return NextResponse.json({ ok: false, message: "记录不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  if (!getMcpPersistenceKind()) return noBackendResponse();
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, message: "缺少 id" }, { status: 400 });
  try {
    const n = await backendDeleteMcpService(id);
    if (n === 0) return NextResponse.json({ ok: false, message: "记录不存在" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
