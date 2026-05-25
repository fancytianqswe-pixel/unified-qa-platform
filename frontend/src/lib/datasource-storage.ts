import type {
  DataSourceForm,
  DataSourceRecord,
  DataSourceStoredConfig,
  DataSourceType,
  DbKind,
} from "@/components/data/types";
import { getDataScopeUserId, scopedLocalStorageKey } from "@/lib/client-data-scope";
import { SUPER_ADMIN_USER_ID } from "@/lib/platform-auth";

export const DATASOURCE_STORAGE_KEY = "datacenter.datasources.v1";

function dataSourcesStorageKey() {
  return scopedLocalStorageKey(DATASOURCE_STORAGE_KEY);
}

/** 分桶前使用全局键；超级管理员若新键列表更空则从旧键迁出并删除旧键 */
function migrateLegacyDataSourcesToScopedIfNeeded(): void {
  if (typeof window === "undefined") return;
  if (getDataScopeUserId() !== SUPER_ADMIN_USER_ID) return;
  let legacyRaw: string;
  try {
    legacyRaw = localStorage.getItem(DATASOURCE_STORAGE_KEY) ?? "";
  } catch {
    return;
  }
  if (!legacyRaw.trim()) return;
  let legacyLen = 0;
  try {
    const a = JSON.parse(legacyRaw) as unknown;
    legacyLen = Array.isArray(a) ? a.length : 0;
  } catch {
    return;
  }
  if (legacyLen === 0) return;

  const scopedKey = dataSourcesStorageKey();
  let scopedLen = 0;
  try {
    const raw = localStorage.getItem(scopedKey);
    if (raw?.trim()) {
      const a = JSON.parse(raw) as unknown;
      scopedLen = Array.isArray(a) ? a.length : 0;
    }
  } catch {
    scopedLen = 0;
  }

  if (legacyLen > scopedLen) {
    try {
      localStorage.setItem(scopedKey, legacyRaw);
      localStorage.removeItem(DATASOURCE_STORAGE_KEY);
      window.dispatchEvent(new Event("datacenter-datasources-changed"));
    } catch {
      // quota
    }
  }
}

const dbKindLabel: Record<DbKind, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlserver: "SQL Server",
  oracle: "Oracle",
  sqlite: "SQLite",
};

export function isDataSourceRecord(x: unknown): x is DataSourceRecord {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const t = o.type;
  const cfg = o.config as Record<string, unknown> | undefined;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    (t === "db" || t === "api" || t === "file" || t === "dcoos") &&
    typeof o.summary === "string" &&
    typeof o.createdAt === "string" &&
    !!cfg &&
    typeof cfg === "object"
  );
}

export function normalizeStoredRecord(x: unknown): DataSourceRecord | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const type = o.type;
  if (!(type === "db" || type === "api" || type === "file" || type === "dcoos")) return null;
  if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.summary !== "string") return null;
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString();
  const cfgRaw = (o.config ?? {}) as Record<string, unknown>;
  const config: DataSourceStoredConfig = {
    name: o.name,
    type,
    dbKind: typeof cfgRaw.dbKind === "string" ? (cfgRaw.dbKind as DbKind) : undefined,
    host: typeof cfgRaw.host === "string" ? cfgRaw.host : undefined,
    port: typeof cfgRaw.port === "string" ? cfgRaw.port : undefined,
    database: typeof cfgRaw.database === "string" ? cfgRaw.database : undefined,
    table: typeof cfgRaw.table === "string" ? cfgRaw.table : undefined,
    username: typeof cfgRaw.username === "string" ? cfgRaw.username : undefined,
    password: typeof cfgRaw.password === "string" ? cfgRaw.password : undefined,
    url: typeof cfgRaw.url === "string" ? cfgRaw.url : undefined,
    method: typeof cfgRaw.method === "string" ? cfgRaw.method : undefined,
    authType: typeof cfgRaw.authType === "string" ? cfgRaw.authType : undefined,
    rootPath: typeof cfgRaw.rootPath === "string" ? cfgRaw.rootPath : undefined,
    keyPath: typeof cfgRaw.keyPath === "string" ? cfgRaw.keyPath : undefined,
    endpoint: typeof cfgRaw.endpoint === "string" ? cfgRaw.endpoint : undefined,
    appId: typeof cfgRaw.appId === "string" ? cfgRaw.appId : undefined,
    appSecret: typeof cfgRaw.appSecret === "string" ? cfgRaw.appSecret : undefined,
    selectedFields: Array.isArray(cfgRaw.selectedFields)
      ? cfgRaw.selectedFields.map((x) => String(x)).filter(Boolean)
      : undefined,
  };
  return {
    id: o.id,
    name: o.name,
    type,
    summary: o.summary,
    createdAt,
    config,
  };
}

export function connectionSummary(form: DataSourceForm): string {
  switch (form.type) {
    case "db": {
      const hp = [form.host, form.port].filter(Boolean).join(":");
      const db = form.database?.trim();
      const tb = form.table?.trim();
      const addr = hp || "";
      const kind = form.dbKind ? `[${dbKindLabel[form.dbKind]}] ` : "";
      if (db && tb) {
        return addr ? `${kind}${addr} / ${db}.${tb}` : `${kind}${db}.${tb}`;
      }
      if (db) return addr ? `${kind}${addr} / ${db}` : `${kind}${db}`;
      return kind || addr || "-";
    }
    case "api":
      return form.url?.trim() || "-";
    case "file":
      return form.rootPath?.trim() || form.host?.trim() || "-";
    case "dcoos":
      return form.endpoint?.trim() || "-";
    default:
      return "-";
  }
}

export function loadDataSourcesFromStorage(): DataSourceRecord[] {
  if (typeof window === "undefined") return [];
  migrateLegacyDataSourcesToScopedIfNeeded();
  try {
    const raw = localStorage.getItem(dataSourcesStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredRecord).filter((item): item is DataSourceRecord => !!item);
  } catch {
    return [];
  }
}

export function saveDataSourcesToStorage(list: DataSourceRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(dataSourcesStorageKey(), JSON.stringify(list));
  } catch {
    // quota
  }
}

/** 追加或按 id 覆盖一条，与数据中心列表共用同一存储 */
export function appendDataSourceRecord(record: DataSourceRecord): void {
  const list = loadDataSourcesFromStorage();
  const next = [record, ...list.filter((r) => r.id !== record.id)];
  saveDataSourcesToStorage(next);
}

export function makeDbRecordFromDraft(draft: DataSourceForm): DataSourceRecord {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ds-${Date.now()}`;
  return {
    id,
    name: draft.name.trim(),
    type: "db" as DataSourceType,
    summary: connectionSummary(draft),
    createdAt: new Date().toISOString(),
    config: { ...draft, type: "db" },
  };
}
