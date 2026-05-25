/**
 * 数据源向导在「直连模型」路径下可用的 OpenAI 风格 function tools（服务端执行，等价于数据中心 API 能力）。
 */
import { mysqlListColumns, mysqlPreviewRows, type DbColumnsBody, type DbTestBody } from "@/lib/datasource-mysql-ops";
import { runDatasourceDbTest } from "@/lib/datasource-test-runner";

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function asConnBody(args: Record<string, unknown>): DbColumnsBody & { name?: string } {
  return {
    type: "db",
    dbKind: String(args.dbKind ?? "mysql").toLowerCase(),
    host: String(args.host ?? "").trim(),
    port: String(args.port ?? "").trim(),
    username: String(args.username ?? "").trim(),
    password: String(args.password ?? "").trim(),
    database: String(args.database ?? "").trim(),
    table: String(args.table ?? "").trim(),
    name: String(args.name ?? "").trim(),
  };
}

export function getDatasourceWizardChatTools(): ChatToolDefinition[] {
  const connProps = {
    type: "object",
    required: ["name", "dbKind", "host", "port", "database", "table", "username", "password"],
    properties: {
      name: { type: "string", description: "数据源显示名称" },
      dbKind: { type: "string", enum: ["mysql", "postgresql", "sqlserver", "oracle", "sqlite"] },
      host: { type: "string" },
      port: { type: "string", description: "端口数字字符串，如 3306" },
      database: { type: "string" },
      table: { type: "string" },
      username: { type: "string" },
      password: { type: "string" },
    },
  };
  return [
    {
      type: "function",
      function: {
        name: "datasource_test_connection",
        description:
          "对数据库数据源做真实连通性探测；与 POST /api/datasource/test 一致：MySQL 优先在本机 Node 直连，失败时再走 HERMES_DATASOURCE_TEST_ENDPOINT（若已配置）。",
        parameters: connProps,
      },
    },
    {
      type: "function",
      function: {
        name: "datasource_list_columns",
        description: "在已通过连通性且为 MySQL 时，读取指定表字段列表（SHOW COLUMNS）。",
        parameters: connProps,
      },
    },
    {
      type: "function",
      function: {
        name: "datasource_preview_sample",
        description:
          "读取样例数据最多 5 行。可选 selectedFields 指定列子集（须为 list_columns 返回的合法字段名）；不传则 SELECT *。",
        parameters: {
          type: "object",
          required: ["name", "dbKind", "host", "port", "database", "table", "username", "password"],
          properties: {
            ...connProps.properties,
            selectedFields: {
              type: "array",
              items: { type: "string" },
              description: "可选；要查询的列名列表",
            },
          },
        },
      },
    },
  ];
}

export async function executeDatasourceWizardTool(name: string, argsJson: string): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return JSON.stringify({ ok: false, message: "工具参数不是合法 JSON" });
  }

  const base = asConnBody(args);
  const testBody: DbTestBody = {
    name: base.name,
    type: "db",
    dbKind: base.dbKind,
    host: base.host,
    port: base.port,
    database: base.database,
    table: base.table,
    username: base.username,
    password: base.password,
  };

  if (name === "datasource_test_connection") {
    const r = await runDatasourceDbTest(testBody);
    return JSON.stringify({
      ok: r.ok,
      latencyMs: r.latencyMs,
      message: r.message,
      errorCode: r.errorCode,
      status: r.status,
      diagnostics: r.diagnostics,
    });
  }

  if (name === "datasource_list_columns") {
    if (String(base.dbKind).toLowerCase() !== "mysql") {
      return JSON.stringify({ ok: false, message: "list_columns 工具当前仅支持 MySQL" });
    }
    const r = await mysqlListColumns(base);
    if (!r.ok) return JSON.stringify({ ok: false, message: r.message });
    return JSON.stringify({ ok: true, fields: r.fields, count: r.fields.length });
  }

  if (name === "datasource_preview_sample") {
    if (String(base.dbKind).toLowerCase() !== "mysql") {
      return JSON.stringify({ ok: false, message: "preview 工具当前仅支持 MySQL" });
    }
    const selectedFields = Array.isArray(args.selectedFields)
      ? (args.selectedFields as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : undefined;
    const r = await mysqlPreviewRows(base, selectedFields?.length ? selectedFields : undefined);
    if (!r.ok) return JSON.stringify({ ok: false, message: r.message });
    return JSON.stringify({ ok: true, rows: r.rows, rowCount: r.rows.length });
  }

  return JSON.stringify({ ok: false, message: `未知工具: ${name}` });
}
