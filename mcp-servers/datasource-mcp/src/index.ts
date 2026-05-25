#!/usr/bin/env node
/**
 * stdio MCP：将数据中心数据源相关能力暴露给 Hermes / Cursor 等宿主。
 * 工具内部通过 HTTP 调用本站 Next `POST /api/datasource/*`（与浏览器草稿卡同源逻辑）。
 *
 * 环境变量：
 * - DATASOURCE_MCP_BASE_URL：Next 根地址，默认 http://127.0.0.1:3000
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const baseUrl = () => (process.env.DATASOURCE_MCP_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { _raw: text };
  }
  return { status: res.status, body: parsed };
}

const connSchema = z.object({
  name: z.string().describe("数据源显示名称"),
  dbKind: z.enum(["mysql", "postgresql", "sqlserver", "oracle", "sqlite"]),
  host: z.string(),
  port: z.string(),
  database: z.string(),
  table: z.string(),
  username: z.string(),
  password: z.string(),
});

function asDbPayload(args: z.infer<typeof connSchema>) {
  return {
    name: args.name,
    type: "db" as const,
    dbKind: args.dbKind,
    host: args.host,
    port: args.port,
    database: args.database,
    table: args.table,
    username: args.username,
    password: args.password,
  };
}

const server = new McpServer({
  name: "xingyan-datasource-mcp",
  version: "1.0.0",
});

server.registerTool(
  "datasource_test_connection",
  {
    description:
      "数据库连通性探测；等价于前端「草稿卡 / 数据中心」调用的 POST /api/datasource/test。八项齐备后优先调用本工具确认可连，再在对话末尾输出 hermes-datasource 或兼容 yaml 以生成草稿卡。",
    inputSchema: connSchema,
  },
  async (args) => {
    const r = await postJson("/api/datasource/test", asDbPayload(args));
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ httpStatus: r.status, ...((r.body as object) || {}) }) }],
    };
  },
);

server.registerTool(
  "datasource_list_columns",
  {
    description:
      "读取表字段（当前实现为 MySQL SHOW COLUMNS）；等价 POST /api/datasource/columns。仅在 test 通过后、且 dbKind=mysql 时使用。",
    inputSchema: connSchema,
  },
  async (args) => {
    const r = await postJson("/api/datasource/columns", asDbPayload(args));
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ httpStatus: r.status, ...((r.body as object) || {}) }) }],
    };
  },
);

const previewSchema = connSchema.extend({
  selectedFields: z.array(z.string()).optional().describe("可选；合法列名子集"),
});

server.registerTool(
  "datasource_preview_sample",
  {
    description:
      "最多 5 行样例；等价 POST /api/datasource/preview。支持 selectedFields。仅在 MySQL 且连接可用时使用。",
    inputSchema: previewSchema,
  },
  async (args) => {
    const { selectedFields, ...rest } = args;
    const body = { ...asDbPayload(rest), ...(selectedFields?.length ? { selectedFields } : {}) };
    const r = await postJson("/api/datasource/preview", body);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ httpStatus: r.status, ...((r.body as object) || {}) }) }],
    };
  },
);

server.registerTool(
  "datasource_save_guidance",
  {
    description:
      "无副作用：返回如何将当前连接写入「数据中心」的说明。真正持久化只能由用户在浏览器点击草稿卡「保存到数据中心」或数据中心弹窗完成（localStorage）。模型在探活/预览成功后应调用本工具一次以提醒输出 hermes-datasource 块。",
    inputSchema: z.object({}),
  },
  async () => {
    const text = [
      "保存边界：MCP 与 BFF 均无法直接写入用户浏览器 localStorage。",
      "请在八项确认且 test 通过后，在回复末尾输出 ```hermes-datasource` + JSON（八键小写）或兼容 ```yaml`，以便前端注入「数据源草稿卡」；用户再在卡片上完成保存。",
      "键名：datacenter.datasources.v1（仅浏览器端）。",
    ].join("\n");
    return { content: [{ type: "text" as const, text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
