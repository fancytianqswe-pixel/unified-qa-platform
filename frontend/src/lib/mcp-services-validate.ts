import type { McpServiceCreateBody, McpTransport } from "@/lib/mcp-services-types";
import { MCP_TRANSPORTS } from "@/lib/mcp-services-types";

function asTransport(v: unknown): McpTransport | null {
  const s = String(v ?? "").trim() as McpTransport;
  return MCP_TRANSPORTS.includes(s) ? s : null;
}

function normalizeArgs(d: Record<string, unknown>): string[] {
  if (Array.isArray(d.args)) return d.args.map((x) => String(x));
  const text = d.argsText ?? d.extraArgs;
  if (typeof text === "string" && text.trim()) return text.trim().split(/\s+/);
  return [];
}

function normalizeEnv(d: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = d.env;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    if (key) out[key] = String(v ?? "");
  }
  return out;
}

function normalizeHeaders(d: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = d.headers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    if (key) out[key] = String(v ?? "");
  }
  return out;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateMcpCreateBody(
  input: unknown,
): { ok: true; data: McpServiceCreateBody } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "请求体无效" };
  const o = input as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name || name.length > 128) return { ok: false, message: "名称必填且不超过 128 字符" };
  const tr = asTransport(o.transport);
  if (!tr) return { ok: false, message: "类型须为 STDIO / SSE / Streamable HTTP / JSON 对应的后端枚举" };
  const def = o.definition;
  if (!def || typeof def !== "object" || Array.isArray(def)) return { ok: false, message: "definition 须为对象" };
  const d = def as Record<string, unknown>;

  if (tr === "stdio") {
    const command = String(d.command ?? "").trim();
    if (!command) return { ok: false, message: "命令必填" };
    const args = normalizeArgs(d);
    const env = normalizeEnv(d);
    return { ok: true, data: { name, transport: tr, definition: { command, args, env } } };
  }

  if (tr === "sse" || tr === "streamable_http") {
    const url = String(d.url ?? "").trim();
    if (!url) return { ok: false, message: "URL 必填" };
    if (!isHttpUrl(url)) return { ok: false, message: "URL 须为 http(s) 合法地址" };
    const headers = normalizeHeaders(d);
    return { ok: true, data: { name, transport: tr, definition: { url, headers } } };
  }

  if (tr === "json") {
    const raw = d.rawJson ?? d.document;
    let parsed: unknown;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return { ok: false, message: "JSON 配置无法解析" };
      }
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      parsed = raw;
    } else if (d.mcpServers && typeof d.mcpServers === "object" && !Array.isArray(d.mcpServers)) {
      parsed = d;
    } else {
      return { ok: false, message: "JSON 配置无效：请粘贴完整 JSON 或保留已保存的 mcpServers 结构" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: "JSON 配置须为对象" };
    }
    const root = parsed as Record<string, unknown>;
    const servers = root.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return { ok: false, message: "JSON 须包含 mcpServers 对象（与 Cursor / Claude 配置格式一致）" };
    }
    return { ok: true, data: { name, transport: tr, definition: { ...root } } };
  }

  return { ok: false, message: "未知类型" };
}
