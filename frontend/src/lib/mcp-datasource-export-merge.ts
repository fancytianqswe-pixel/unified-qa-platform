/**
 * 导出 Hermes/Cursor 用 `mcpServers` JSON 时，可选并入「统一质检平台数据源 MCP」stdio 定义。
 * 由部署方设置 DATASOURCE_MCP_CLI_PATH（指向已构建的 dist/index.js）后生效。
 * `allowMerge === false` 时跳过（由系统管理「内置服务」开关控制）。
 */
export function mergeDatasourceMcpIntoServersIfConfigured(
  mcpServers: Record<string, unknown>,
  opts?: { allowMerge?: boolean },
): void {
  if (opts?.allowMerge === false) return;
  const cli = process.env.DATASOURCE_MCP_CLI_PATH?.trim();
  if (!cli) return;
  const base = process.env.DATASOURCE_MCP_BASE_URL?.trim() || "http://127.0.0.1:3000";
  const name = process.env.DATASOURCE_MCP_SERVER_NAME?.trim() || "xingyan-datasource";
  mcpServers[name] = {
    command: "node",
    args: [cli],
    env: { DATASOURCE_MCP_BASE_URL: base },
  };
}
