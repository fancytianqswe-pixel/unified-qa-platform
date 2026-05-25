import { NextResponse } from "next/server";
import {
  backendGetBuiltinMasterEnabled,
  backendSetBuiltinMasterEnabled,
  describeRegisteredBuiltinMcps,
  getMcpPersistenceKind,
} from "@/lib/mcp-platform-backend";
import {
  envDatasourceMcpConfigured,
  envMineruApiMcpConfigured,
  envMineruLocalMcpConfigured,
} from "@/lib/mcp-builtin-keys";

function noBackend() {
  return NextResponse.json(
    { ok: false, message: "未配置持久化，无法读写内置 MCP 开关。请配置 PLATFORM_MYSQL_* 或使用开发文件仓库。" },
    { status: 503 },
  );
}

/** 内置服务总开关 + 当前会出现在导出中的内置 MCP 说明（供只读一览）。 */
export async function GET() {
  if (!getMcpPersistenceKind()) return noBackend();
  try {
    const builtinServicesEnabled = await backendGetBuiltinMasterEnabled();
    const envConfigured = {
      datasourceMcp: envDatasourceMcpConfigured(),
      mineruLocalMcp: envMineruLocalMcpConfigured(),
      mineruApiMcp: envMineruApiMcpConfigured(),
    };
    const registeredBuiltinMcps = describeRegisteredBuiltinMcps(builtinServicesEnabled, envConfigured);
    const kind = getMcpPersistenceKind();
    return NextResponse.json({
      ok: true,
      builtinServicesEnabled,
      envConfigured,
      registeredBuiltinMcps,
      connected: true,
      persistence: kind,
      devFileStore: kind === "file",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!getMcpPersistenceKind()) return noBackend();
  let body: { builtinServicesEnabled?: boolean };
  try {
    body = (await request.json()) as { builtinServicesEnabled?: boolean };
  } catch {
    return NextResponse.json({ ok: false, message: "请求体须为 JSON" }, { status: 400 });
  }
  if (typeof body.builtinServicesEnabled !== "boolean") {
    return NextResponse.json({ ok: false, message: "builtinServicesEnabled 须为布尔值" }, { status: 400 });
  }
  try {
    await backendSetBuiltinMasterEnabled(body.builtinServicesEnabled);
    const builtinServicesEnabled = await backendGetBuiltinMasterEnabled();
    const envConfigured = {
      datasourceMcp: envDatasourceMcpConfigured(),
      mineruLocalMcp: envMineruLocalMcpConfigured(),
      mineruApiMcp: envMineruApiMcpConfigured(),
    };
    const registeredBuiltinMcps = describeRegisteredBuiltinMcps(builtinServicesEnabled, envConfigured);
    return NextResponse.json({
      ok: true,
      builtinServicesEnabled,
      envConfigured,
      registeredBuiltinMcps,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
