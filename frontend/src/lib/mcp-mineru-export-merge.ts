/**
 * 导出 Hermes/Cursor 用 `mcpServers` JSON 时，可选并入 MinerU 相关 stdio MCP。
 *
 * - MINERU_LOCAL_MCP_CLI_PATH → 本地 CLI 包装（需本机已安装 mineru）
 * - MINERU_API_MCP_CLI_PATH → HTTP API 包装（需已启动 mineru-api）
 *
 * `allowLocal` / `allowApi` 为 false 时跳过对应项（内置服务开关）。
 */
export function mergeMineruMcpsIntoServersIfConfigured(
  mcpServers: Record<string, unknown>,
  opts?: { allowLocal?: boolean; allowApi?: boolean },
): {
  mineruLocalMcpMerged: boolean;
  mineruApiMcpMerged: boolean;
} {
  let mineruLocalMcpMerged = false;
  let mineruApiMcpMerged = false;

  const localCli = process.env.MINERU_LOCAL_MCP_CLI_PATH?.trim();
  if (localCli && opts?.allowLocal !== false) {
    mineruLocalMcpMerged = true;
    const name = process.env.MINERU_LOCAL_MCP_SERVER_NAME?.trim() || "xingyan-mineru-local";
    const exe = process.env.MINERU_EXECUTABLE?.trim() || "mineru";
    const timeout = process.env.MINERU_CLI_TIMEOUT_MS?.trim();
    mcpServers[name] = {
      command: "node",
      args: [localCli],
      env: {
        MINERU_EXECUTABLE: exe,
        ...(timeout ? { MINERU_CLI_TIMEOUT_MS: timeout } : {}),
      },
    };
  }

  const apiCli = process.env.MINERU_API_MCP_CLI_PATH?.trim();
  if (apiCli && opts?.allowApi !== false) {
    mineruApiMcpMerged = true;
    const name = process.env.MINERU_API_MCP_SERVER_NAME?.trim() || "xingyan-mineru-api";
    const base = process.env.MINERU_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
    const readPrefix = process.env.MINERU_API_ALLOWED_READ_PREFIX?.trim();
    const defaultBackend = process.env.MINERU_API_DEFAULT_BACKEND?.trim();
    mcpServers[name] = {
      command: "node",
      args: [apiCli],
      env: {
        MINERU_API_BASE_URL: base,
        ...(readPrefix ? { MINERU_API_ALLOWED_READ_PREFIX: readPrefix } : {}),
        ...(defaultBackend ? { MINERU_API_DEFAULT_BACKEND: defaultBackend } : {}),
      },
    };
  }

  return { mineruLocalMcpMerged, mineruApiMcpMerged };
}
