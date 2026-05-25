import { NextResponse } from "next/server";
import {
  backendGetBuiltinExportMergeFlags,
  backendListMcpServices,
  buildMcpServersExportPayload,
  getMcpPersistenceKind,
} from "@/lib/mcp-platform-backend";
import { mergeDatasourceMcpIntoServersIfConfigured } from "@/lib/mcp-datasource-export-merge";
import { mergeMineruMcpsIntoServersIfConfigured } from "@/lib/mcp-mineru-export-merge";

function noBackend() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "未配置持久化：请设置 PLATFORM_MYSQL_*（生产推荐），或在非 production 环境使用开发文件仓库；生产环境也可设置 PLATFORM_MCP_FILE_STORE=1 启用本地文件（不推荐）。详见 .env.example。",
    },
    { status: 503 },
  );
}

/** 导出已启用的自定义 MCP 为 Cursor 风格 `mcpServers` JSON，便于复制到客户端配置。 */
export async function GET() {
  if (!getMcpPersistenceKind()) return noBackend();
  try {
    const list = await backendListMcpServices();
    const payload = buildMcpServersExportPayload(list);
    const mergeFlags = await backendGetBuiltinExportMergeFlags();
    mergeDatasourceMcpIntoServersIfConfigured(payload.mcpServers, {
      allowMerge: mergeFlags.datasource,
    });
    const mineru = mergeMineruMcpsIntoServersIfConfigured(payload.mcpServers, {
      allowLocal: mergeFlags.mineruLocal,
      allowApi: mergeFlags.mineruApi,
    });
    const datasourceMcpMerged =
      mergeFlags.datasource && Boolean(process.env.DATASOURCE_MCP_CLI_PATH?.trim());
    return NextResponse.json({ ok: true, ...payload, datasourceMcpMerged, ...mineru });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "导出失败";
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
