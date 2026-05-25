import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

/**
 * 平台业务库连接（与「用户填的数据源连接」分离）。
 * 配置 `PLATFORM_MYSQL_URL` 或 `PLATFORM_MYSQL_HOST` + 账号库名后，系统管理 MCP 等能力写入该库。
 */
export function getPlatformMysqlPool(): mysql.Pool | null {
  if (pool) return pool;
  const url = process.env.PLATFORM_MYSQL_URL?.trim();
  if (url) {
    pool = mysql.createPool(url);
    return pool;
  }
  const host = process.env.PLATFORM_MYSQL_HOST?.trim();
  if (!host) return null;
  pool = mysql.createPool({
    host,
    port: Number(process.env.PLATFORM_MYSQL_PORT || "3306"),
    user: process.env.PLATFORM_MYSQL_USER ?? "",
    password: process.env.PLATFORM_MYSQL_PASSWORD ?? "",
    database: process.env.PLATFORM_MYSQL_DATABASE?.trim() || "platform",
    waitForConnections: true,
    connectionLimit: 8,
  });
  return pool;
}

export function platformMysqlConfigured(): boolean {
  return !!(process.env.PLATFORM_MYSQL_URL?.trim() || process.env.PLATFORM_MYSQL_HOST?.trim());
}

/** 首次访问时建表，便于新环境启动；生产亦可改为只执行迁移 SQL。 */
export async function ensurePlatformMcpServicesTable(p: mysql.Pool): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS platform_mcp_services (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      transport VARCHAR(32) NOT NULL,
      definition_json JSON NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_platform_mcp_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** 内置 MCP 能力开关（如「系统能力」） */
export async function ensurePlatformMcpBuiltinPrefsTable(p: mysql.Pool): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS platform_mcp_builtin_prefs (
      builtin_key VARCHAR(64) NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
