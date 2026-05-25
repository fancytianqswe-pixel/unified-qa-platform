import { randomUUID } from "crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { BUILTIN_PREF_SYSTEM_CAPABILITIES } from "@/lib/mcp-builtin-keys";
import type { McpServiceCreateBody, McpServicePublic, McpTransport } from "@/lib/mcp-services-types";
import { MCP_TRANSPORTS } from "@/lib/mcp-services-types";

const STORE_FILE = ".platform-mcp-store.json";

type FileRow = {
  id: string;
  name: string;
  transport: string;
  definition: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type FileRoot = {
  services: FileRow[];
  builtinPrefs: Record<string, boolean>;
};

const filePath = () => path.join(process.cwd(), STORE_FILE);

let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function normalizeRoot(raw: unknown): FileRoot {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const services = Array.isArray(o.services) ? (o.services as FileRow[]) : [];
  const builtinPrefs =
    o.builtinPrefs && typeof o.builtinPrefs === "object" && !Array.isArray(o.builtinPrefs)
      ? (o.builtinPrefs as Record<string, boolean>)
      : {};
  return { services, builtinPrefs };
}

async function readRoot(): Promise<FileRoot> {
  try {
    const text = await fs.readFile(filePath(), "utf8");
    return normalizeRoot(JSON.parse(text) as unknown);
  } catch {
    return { services: [], builtinPrefs: {} };
  }
}

async function writeRoot(root: FileRoot): Promise<void> {
  const p = filePath();
  const tmp = `${p}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  await fs.rename(tmp, p);
}

function asTransport(v: string): McpTransport | null {
  const s = v.trim() as McpTransport;
  return MCP_TRANSPORTS.includes(s) ? s : null;
}

function toPublic(row: FileRow): McpServicePublic | null {
  const tr = asTransport(row.transport);
  if (!tr) return null;
  return {
    id: row.id,
    name: row.name,
    transport: tr,
    definition: row.definition && typeof row.definition === "object" ? row.definition : {},
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function fileListMcpServices(): Promise<McpServicePublic[]> {
  return serialize(async () => {
    const root = await readRoot();
    const out: McpServicePublic[] = [];
    for (const row of root.services) {
      const pub = toPublic(row);
      if (pub) out.push(pub);
    }
    out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return out;
  });
}

export async function fileGetMcpServiceById(id: string): Promise<McpServicePublic | null> {
  return serialize(async () => {
    const root = await readRoot();
    const row = root.services.find((s) => s.id === id);
    return row ? toPublic(row) : null;
  });
}

export async function fileInsertMcpService(id: string, body: McpServiceCreateBody): Promise<void> {
  return serialize(async () => {
    const root = await readRoot();
    const now = new Date().toISOString();
    root.services.push({
      id,
      name: body.name.trim(),
      transport: body.transport,
      definition: body.definition as Record<string, unknown>,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeRoot(root);
  });
}

export async function fileUpdateMcpService(
  id: string,
  body: Pick<McpServiceCreateBody, "name" | "transport" | "definition">,
): Promise<number> {
  return serialize(async () => {
    const root = await readRoot();
    const idx = root.services.findIndex((s) => s.id === id);
    if (idx < 0) return 0;
    const now = new Date().toISOString();
    root.services[idx] = {
      ...root.services[idx],
      name: body.name.trim(),
      transport: body.transport,
      definition: body.definition as Record<string, unknown>,
      updatedAt: now,
    };
    await writeRoot(root);
    return 1;
  });
}

export async function fileDeleteMcpService(id: string): Promise<number> {
  return serialize(async () => {
    const root = await readRoot();
    const before = root.services.length;
    root.services = root.services.filter((s) => s.id !== id);
    await writeRoot(root);
    return before - root.services.length;
  });
}

export async function fileIsMcpNameTakenByOther(name: string, excludeId: string | null): Promise<boolean> {
  return serialize(async () => {
    const root = await readRoot();
    const n = name.trim();
    return root.services.some((s) => s.name === n && (!excludeId || s.id !== excludeId));
  });
}

export async function fileSetMcpServiceEnabled(id: string, enabled: boolean): Promise<number> {
  return serialize(async () => {
    const root = await readRoot();
    const row = root.services.find((s) => s.id === id);
    if (!row) return 0;
    row.enabled = enabled;
    row.updatedAt = new Date().toISOString();
    await writeRoot(root);
    return 1;
  });
}

export async function fileGetBuiltinPref(key: string): Promise<boolean | undefined> {
  return serialize(async () => {
    const root = await readRoot();
    if (!Object.prototype.hasOwnProperty.call(root.builtinPrefs, key)) return undefined;
    return Boolean(root.builtinPrefs[key]);
  });
}

export async function fileSetBuiltinPref(key: string, enabled: boolean): Promise<void> {
  return serialize(async () => {
    const root = await readRoot();
    root.builtinPrefs[key] = enabled;
    await writeRoot(root);
  });
}

export async function fileGetBuiltinEnabled(): Promise<boolean> {
  const v = await fileGetBuiltinPref(BUILTIN_PREF_SYSTEM_CAPABILITIES);
  return v === true;
}

export async function fileSetBuiltinEnabled(enabled: boolean): Promise<void> {
  await fileSetBuiltinPref(BUILTIN_PREF_SYSTEM_CAPABILITIES, enabled);
}
