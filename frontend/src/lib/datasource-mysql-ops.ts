/**
 * 数据源 MySQL 侧真实探测/列/预览（供 API Route 与对话 BFF 工具共用）。
 */
import mysql from "mysql2/promise";
import { isDatasourcePasswordPlaceholder } from "@/lib/datasource-password";

export type DbTestBody = {
  name?: string;
  type?: string;
  dbKind?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  table?: string;
};

export type DbColumnsBody = {
  type?: string;
  dbKind?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  table?: string;
};

const supportedDbKinds = new Set(["mysql", "postgresql", "sqlserver", "oracle", "sqlite"]);

function isValidHost(host: string) {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (value === "localhost") return true;
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  return ipv4.test(value) || domain.test(value);
}

function isValidPort(port: string) {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function validateDbTestPayload(body: DbTestBody): { ok: false; message: string; errorCode: string } | null {
  if (!String(body.dbKind ?? "").trim() || !supportedDbKinds.has(String(body.dbKind).toLowerCase())) {
    return { ok: false, errorCode: "DB_KIND_REQUIRED", message: "请选择受支持的数据库类型：MySQL/PostgreSQL/SQL Server/Oracle/SQLite" };
  }
  if (!String(body.database ?? "").trim() || !String(body.table ?? "").trim()) {
    return { ok: false, errorCode: "DB_TABLE_REQUIRED", message: "DB 数据源必须同时指定数据库与数据表，不能只接入库" };
  }
  if (!String(body.host ?? "").trim() || !isValidHost(String(body.host))) {
    return { ok: false, errorCode: "DB_HOST_INVALID", message: "请填写合法主机地址（域名/IP/localhost）" };
  }
  if (!String(body.port ?? "").trim() || !isValidPort(String(body.port))) {
    return { ok: false, errorCode: "DB_PORT_INVALID", message: "请填写合法端口（1-65535）" };
  }
  if (!String(body.username ?? "").trim() || !String(body.password ?? "").trim()) {
    return { ok: false, errorCode: "DB_CREDENTIAL_REQUIRED", message: "请填写数据库用户名与密码" };
  }
  if (isDatasourcePasswordPlaceholder(body.password)) {
    return {
      ok: false,
      errorCode: "DB_PASSWORD_PLACEHOLDER",
      message:
        "密码为展示用占位符（如 ***），不能用于真实连通性探测。请在草稿卡片中填写真实密码，或让助手在 hermes-datasource 块中输出完整 password 后重新生成卡片。",
    };
  }
  return null;
}

export async function probeMysqlConnectivity(body: DbTestBody): Promise<{
  ok: true;
  latencyMs: number;
  message: string;
} | { ok: false; message: string }> {
  const started = Date.now();
  const connection = await mysql.createConnection({
    host: body.host!,
    port: Number(body.port),
    user: body.username!,
    password: body.password!,
    database: body.database!,
    charset: "utf8mb4",
    connectTimeout: 10000,
  });
  try {
    await connection.query("SELECT 1");
    const tableName = mysql.escapeId(body.table!);
    await connection.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
    return { ok: true, latencyMs: Date.now() - started, message: "真实连通性探测成功" };
  } finally {
    await connection.end();
  }
}

export async function mysqlListColumns(body: DbColumnsBody): Promise<{ ok: true; fields: string[] } | { ok: false; message: string }> {
  if (!body.host || !body.port || !body.username || !body.password || !body.database || !body.table) {
    return { ok: false, message: "请先填写完整的库表连接信息" };
  }
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: body.host,
      port: Number(body.port),
      user: body.username,
      password: body.password,
      database: body.database,
      charset: "utf8mb4",
      connectTimeout: 10000,
    });
    const tableName = mysql.escapeId(body.table);
    const [rows] = await conn.query(`SHOW COLUMNS FROM ${tableName}`);
    const fields = (rows as Array<{ Field?: string }>)
      .map((r) => String(r.Field ?? "").trim())
      .filter(Boolean);
    return { ok: true, fields };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "读取字段失败" };
  } finally {
    if (conn) await conn.end();
  }
}

export async function mysqlPreviewRows(
  body: DbColumnsBody,
  selectedFields?: string[] | null,
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; message: string }> {
  if (!body.host || !body.port || !body.username || !body.password || !body.database || !body.table) {
    return { ok: false, message: "请先填写完整的库表连接信息" };
  }
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: body.host,
      port: Number(body.port),
      user: body.username,
      password: body.password,
      database: body.database,
      charset: "utf8mb4",
      connectTimeout: 10000,
    });
    const tableName = mysql.escapeId(body.table);
    let selectList = "*";
    if (Array.isArray(selectedFields) && selectedFields.length > 0) {
      const safe = selectedFields.map((c) => mysql.escapeId(c)).join(", ");
      selectList = safe;
    }
    const [rows] = await conn.query(`SELECT ${selectList} FROM ${tableName} LIMIT 5`);
    return { ok: true, rows: rows as Array<Record<string, unknown>> };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "读取示例数据失败" };
  } finally {
    if (conn) await conn.end();
  }
}
