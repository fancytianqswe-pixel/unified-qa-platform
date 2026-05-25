/** 平台库 `platform_mcp_builtin_prefs.builtin_key` 与文件仓库 `builtinPrefs` 的键名 */

/** 整体内置服务（系统能力 + 导出合并的数据源/MinerU stdio）总开关 */
export const BUILTIN_PREF_MASTER = "builtin_services_enabled";

/** 兼容旧版：曾单独存储「系统能力」 */
export const BUILTIN_PREF_SYSTEM_CAPABILITIES = "system_capabilities";

export function envDatasourceMcpConfigured(): boolean {
  return Boolean(process.env.DATASOURCE_MCP_CLI_PATH?.trim());
}

export function envMineruLocalMcpConfigured(): boolean {
  return Boolean(process.env.MINERU_LOCAL_MCP_CLI_PATH?.trim());
}

export function envMineruApiMcpConfigured(): boolean {
  return Boolean(process.env.MINERU_API_MCP_CLI_PATH?.trim());
}
