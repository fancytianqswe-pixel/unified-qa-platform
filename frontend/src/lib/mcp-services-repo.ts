import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ensurePlatformMcpServicesTable } from "@/lib/platform-mysql";
import type { McpServiceCreateBody, McpServicePublic, McpTransport } from "@/lib/mcp-services-types";
import { MCP_TRANSPORTS } from "@/lib/mcp-services-types";

function asTransport(v: unknown): McpTransport | null {
  const s = String(v ?? "").trim() as McpTransport;
  return MCP_TRANSPORTS.includes(s) ? s : null;
}

function toIso(d: unknown): string {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  if (typeof d === "string") return d;
  return new Date(0).toISOString();
}

function parseDefinition(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function listMcpServices(pool: Pool): Promise<McpServicePublic[]> {
  await ensurePlatformMcpServicesTable(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, transport, definition_json, enabled, created_at, updated_at
     FROM platform_mcp_services ORDER BY updated_at DESC`,
  );
  const out: McpServicePublic[] = [];
  for (const r of rows) {
    const tr = asTransport(r.transport);
    if (!tr) continue;
    out.push({
      id: String(r.id),
      name: String(r.name),
      transport: tr,
      definition: parseDefinition(r.definition_json),
      enabled: Boolean(r.enabled),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    });
  }
  return out;
}

export async function getMcpServiceById(pool: Pool, id: string): Promise<McpServicePublic | null> {
  await ensurePlatformMcpServicesTable(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, transport, definition_json, enabled, created_at, updated_at
     FROM platform_mcp_services WHERE id = ? LIMIT 1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const tr = asTransport(r.transport);
  if (!tr) return null;
  return {
    id: String(r.id),
    name: String(r.name),
    transport: tr,
    definition: parseDefinition(r.definition_json),
    enabled: Boolean(r.enabled),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function insertMcpService(pool: Pool, id: string, body: McpServiceCreateBody): Promise<void> {
  await ensurePlatformMcpServicesTable(pool);
  await pool.execute<ResultSetHeader>(
    `INSERT INTO platform_mcp_services (id, name, transport, definition_json, enabled)
     VALUES (?, ?, ?, ?, 1)`,
    [id, body.name.trim(), body.transport, JSON.stringify(body.definition)],
  );
}

export async function updateMcpService(
  pool: Pool,
  id: string,
  body: Pick<McpServiceCreateBody, "name" | "transport" | "definition">,
): Promise<number> {
  await ensurePlatformMcpServicesTable(pool);
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE platform_mcp_services
     SET name = ?, transport = ?, definition_json = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [body.name.trim(), body.transport, JSON.stringify(body.definition), id],
  );
  return res.affectedRows ?? 0;
}

export async function deleteMcpService(pool: Pool, id: string): Promise<number> {
  await ensurePlatformMcpServicesTable(pool);
  const [res] = await pool.execute<ResultSetHeader>(`DELETE FROM platform_mcp_services WHERE id = ?`, [id]);
  return res.affectedRows ?? 0;
}

export async function setMcpServiceEnabled(pool: Pool, id: string, enabled: boolean): Promise<number> {
  await ensurePlatformMcpServicesTable(pool);
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE platform_mcp_services SET enabled = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [enabled ? 1 : 0, id],
  );
  return res.affectedRows ?? 0;
}

export async function isMcpNameTakenByOther(pool: Pool, name: string, excludeId: string | null): Promise<boolean> {
  await ensurePlatformMcpServicesTable(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    excludeId
      ? `SELECT id FROM platform_mcp_services WHERE name = ? AND id <> ? LIMIT 1`
      : `SELECT id FROM platform_mcp_services WHERE name = ? LIMIT 1`,
    excludeId ? [name.trim(), excludeId] : [name.trim()],
  );
  return rows.length > 0;
}
