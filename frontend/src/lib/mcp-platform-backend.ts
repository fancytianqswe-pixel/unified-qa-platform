import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import {
  BUILTIN_PREF_MASTER,
  BUILTIN_PREF_SYSTEM_CAPABILITIES,
  envDatasourceMcpConfigured,
  envMineruApiMcpConfigured,
  envMineruLocalMcpConfigured,
} from "@/lib/mcp-builtin-keys";
import * as fileStore from "@/lib/mcp-services-file-store";
import {
  deleteMcpService,
  getMcpServiceById,
  insertMcpService,
  isMcpNameTakenByOther,
  listMcpServices,
  setMcpServiceEnabled,
  updateMcpService,
} from "@/lib/mcp-services-repo";
import type { McpServiceCreateBody, McpServicePublic } from "@/lib/mcp-services-types";
import { ensurePlatformMcpBuiltinPrefsTable, getPlatformMysqlPool, platformMysqlConfigured } from "@/lib/platform-mysql";

export type McpPersistenceKind = "mysql" | "file";

/** 未配置平台 MySQL 时，非 production 或显式 `PLATFORM_MCP_FILE_STORE=1` 时使用本地 JSON 文件持久化（便于本机开发）。 */
export function platformMcpUsesFileStore(): boolean {
  if (platformMysqlConfigured()) return false;
  const raw = process.env.PLATFORM_MCP_FILE_STORE?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return process.env.NODE_ENV !== "production";
}

export function getMcpPersistenceKind(): McpPersistenceKind | null {
  if (platformMysqlConfigured()) {
    const pool = getPlatformMysqlPool();
    if (pool) return "mysql";
  }
  if (platformMcpUsesFileStore()) return "file";
  return null;
}

function poolOrThrow(): Pool {
  const p = getPlatformMysqlPool();
  if (!p) throw new Error("平台库连接不可用");
  return p;
}

export async function backendListMcpServices(): Promise<McpServicePublic[]> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return listMcpServices(poolOrThrow());
  if (k === "file") return fileStore.fileListMcpServices();
  throw new Error("NO_BACKEND");
}

export async function backendGetMcpServiceById(id: string): Promise<McpServicePublic | null> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return getMcpServiceById(poolOrThrow(), id);
  if (k === "file") return fileStore.fileGetMcpServiceById(id);
  throw new Error("NO_BACKEND");
}

export async function backendInsertMcpService(id: string, body: McpServiceCreateBody): Promise<void> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return insertMcpService(poolOrThrow(), id, body);
  if (k === "file") return fileStore.fileInsertMcpService(id, body);
  throw new Error("NO_BACKEND");
}

export async function backendUpdateMcpService(
  id: string,
  body: Pick<McpServiceCreateBody, "name" | "transport" | "definition">,
): Promise<number> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return updateMcpService(poolOrThrow(), id, body);
  if (k === "file") return fileStore.fileUpdateMcpService(id, body);
  throw new Error("NO_BACKEND");
}

export async function backendDeleteMcpService(id: string): Promise<number> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return deleteMcpService(poolOrThrow(), id);
  if (k === "file") return fileStore.fileDeleteMcpService(id);
  throw new Error("NO_BACKEND");
}

export async function backendIsMcpNameTakenByOther(name: string, excludeId: string | null): Promise<boolean> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return isMcpNameTakenByOther(poolOrThrow(), name, excludeId);
  if (k === "file") return fileStore.fileIsMcpNameTakenByOther(name, excludeId);
  throw new Error("NO_BACKEND");
}

export async function backendSetMcpServiceEnabled(id: string, enabled: boolean): Promise<number> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") return setMcpServiceEnabled(poolOrThrow(), id, enabled);
  if (k === "file") return fileStore.fileSetMcpServiceEnabled(id, enabled);
  throw new Error("NO_BACKEND");
}

export async function backendGetBuiltinPref(key: string): Promise<boolean | undefined> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") {
    const pool = poolOrThrow();
    await ensurePlatformMcpBuiltinPrefsTable(pool);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT enabled FROM platform_mcp_builtin_prefs WHERE builtin_key = ? LIMIT 1`,
      [key],
    );
    const row = rows[0] as { enabled?: number } | undefined;
    if (!row) return undefined;
    return Number(row.enabled) === 1;
  }
  if (k === "file") return fileStore.fileGetBuiltinPref(key);
  throw new Error("NO_BACKEND");
}

export async function backendSetBuiltinPref(key: string, enabled: boolean): Promise<void> {
  const k = getMcpPersistenceKind();
  if (k === "mysql") {
    const pool = poolOrThrow();
    await ensurePlatformMcpBuiltinPrefsTable(pool);
    await pool.execute(
      `INSERT INTO platform_mcp_builtin_prefs (builtin_key, enabled) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = CURRENT_TIMESTAMP(3)`,
      [key, enabled ? 1 : 0],
    );
    return;
  }
  if (k === "file") return fileStore.fileSetBuiltinPref(key, enabled);
  throw new Error("NO_BACKEND");
}

/** 整体内置服务开关：关闭后导出不再并入数据源/MinerU stdio，且系统能力视为关闭；未配置 master 时兼容读取旧 `system_capabilities`。 */
export async function backendGetBuiltinMasterEnabled(): Promise<boolean> {
  const master = await backendGetBuiltinPref(BUILTIN_PREF_MASTER);
  if (master !== undefined) return master === true;
  const legacy = await backendGetBuiltinPref(BUILTIN_PREF_SYSTEM_CAPABILITIES);
  if (legacy !== undefined) return legacy === true;
  return true;
}

export async function backendSetBuiltinMasterEnabled(enabled: boolean): Promise<void> {
  await backendSetBuiltinPref(BUILTIN_PREF_MASTER, enabled);
}

export async function backendGetBuiltinSystemCapabilities(): Promise<boolean> {
  return backendGetBuiltinMasterEnabled();
}

export async function backendSetBuiltinSystemCapabilities(enabled: boolean): Promise<void> {
  await backendSetBuiltinMasterEnabled(enabled);
}

/** 导出 JSON 时是否并入对应 stdio 块（总开关开启且已配置环境变量）。 */
export async function backendGetBuiltinExportMergeFlags(): Promise<{
  datasource: boolean;
  mineruLocal: boolean;
  mineruApi: boolean;
}> {
  const master = await backendGetBuiltinMasterEnabled();
  return {
    datasource: master && envDatasourceMcpConfigured(),
    mineruLocal: master && envMineruLocalMcpConfigured(),
    mineruApi: master && envMineruApiMcpConfigured(),
  };
}

/** 内置清单行类型：与 `mcp.builtinInventory.*` 文案键对齐 */
export type BuiltinMcpInventoryKind = "platformCapabilities" | "datasource" | "mineruLocal" | "mineruApi";

export type RegisteredBuiltinMcpRow = {
  kind: BuiltinMcpInventoryKind;
  /** 展示用名称：首行固定文案走 i18n；数据源/MinerU 行为环境变量中的技术名，不翻译 */
  name: string;
  /** 中文兜底文案；界面优先用 `mcp.builtinInventory.{kind}.purpose` */
  purpose: string;
};

/**
 * 系统管理页「内置」只读表的用途列：面向管理员用一句话说清「能干什么」。
 * 总开关开启时固定列出系统能力、数据源、MinerU 本地、MinerU API 四行（名称仍读环境变量默认值）。
 * `env` 保留供路由/导出逻辑传参，用途文案不依赖各 *_CLI_PATH 是否已配置。
 */
export function describeRegisteredBuiltinMcps(
  master: boolean,
  _env: { datasourceMcp: boolean; mineruLocalMcp: boolean; mineruApiMcp: boolean },
): RegisteredBuiltinMcpRow[] {
  if (!master) return [];
  const dsName = process.env.DATASOURCE_MCP_SERVER_NAME?.trim() || "xingyan-datasource";
  const mlName = process.env.MINERU_LOCAL_MCP_SERVER_NAME?.trim() || "xingyan-mineru-local";
  const maName = process.env.MINERU_API_MCP_SERVER_NAME?.trim() || "xingyan-mineru-api";
  return [
    {
      kind: "platformCapabilities",
      name: "系统能力",
      purpose: "为对话里的 AI 提供平台在网关侧的基础系统能力（与上方「内置MCP」开关一起生效）。",
    },
    {
      kind: "datasource",
      name: dsName,
      purpose: "在对话里协助测试数据库是否连得上、查看表有哪些字段、预览几条示例数据，并引导把数据源保存到数据中心。",
    },
    {
      kind: "mineruLocal",
      name: mlName,
      purpose: "在本机用 MinerU 把 PDF、Office 等文档解析成可阅读的文字内容。",
    },
    {
      kind: "mineruApi",
      name: maName,
      purpose: "通过已启动的 MinerU 解析服务，上传文件完成文档解析。",
    },
  ];
}

/** 合并为 Cursor / Claude 风格的 `mcpServers` 导出（仅包含 `enabled` 为 true 的项）。 */
export function buildMcpServersExportPayload(list: McpServicePublic[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const s of list) {
    if (!s.enabled) continue;
    const key = s.name.trim();
    if (!key) continue;
    const d = s.definition;
    if (s.transport === "stdio") {
      const command = String((d as { command?: unknown }).command ?? "").trim();
      if (!command) continue;
      const args = Array.isArray((d as { args?: unknown }).args)
        ? ((d as { args: unknown[] }).args as unknown[]).map((x) => String(x))
        : [];
      const env =
        (d as { env?: unknown }).env && typeof (d as { env?: unknown }).env === "object" && !Array.isArray((d as { env: unknown }).env)
          ? (Object.fromEntries(
              Object.entries((d as { env: Record<string, unknown> }).env).map(([k, v]) => [k, String(v ?? "")]),
            ) as Record<string, string>)
          : {};
      mcpServers[key] = {
        command,
        ...(args.length ? { args } : {}),
        ...(Object.keys(env).length ? { env } : {}),
      };
    } else if (s.transport === "sse" || s.transport === "streamable_http") {
      const url = String((d as { url?: unknown }).url ?? "").trim();
      if (!url) continue;
      const headers =
        (d as { headers?: unknown }).headers &&
        typeof (d as { headers: unknown }).headers === "object" &&
        !Array.isArray((d as { headers: unknown }).headers)
          ? (Object.fromEntries(
              Object.entries((d as { headers: Record<string, unknown> }).headers).map(([k, v]) => [
                k,
                String(v ?? ""),
              ]),
            ) as Record<string, string>)
          : {};
      mcpServers[key] = {
        url,
        ...(Object.keys(headers).length ? { headers } : {}),
      };
    } else if (s.transport === "json") {
      const servers = (d as { mcpServers?: unknown }).mcpServers;
      if (servers && typeof servers === "object" && !Array.isArray(servers)) {
        Object.assign(mcpServers, servers as Record<string, unknown>);
      }
    }
  }
  return { mcpServers };
}
