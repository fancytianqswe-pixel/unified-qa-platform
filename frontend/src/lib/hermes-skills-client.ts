/**
 * Resolve Hermes Gateway HTTP roots for skills catalog (same host as /v1, not under /v1).
 * Used when HERMES_SKILLS_*_ENDPOINT are unset — BFF calls Gateway-native /api/skills*.
 */

import { appendDefaultHermesGatewayRoots } from "@/lib/hermes-default-gateway-roots";

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export function hermesGatewayRootFromV1Base(v1Base: string): string {
  const raw = stripTrailingSlash(v1Base.trim());
  if (raw.endsWith("/v1")) {
    return raw.slice(0, -3).replace(/\/+$/, "") || raw;
  }
  return raw;
}

/** Gateway roots (no /v1 suffix)，含环境变量与常见本机/Docker 默认地址。 */
export function getHermesGatewayRootsForSkills(): string[] {
  const roots = new Set<string>();
  const gw = process.env.HERMES_GATEWAY_URL?.trim();
  if (gw) {
    roots.add(stripTrailingSlash(gw));
  }
  const turn = process.env.HERMES_TURN_ENDPOINT?.trim();
  if (turn) {
    const raw = stripTrailingSlash(turn);
    let v1base: string;
    if (raw.includes("/v1/")) {
      v1base = `${raw.split("/v1/")[0]}/v1`;
    } else if (raw.endsWith("/v1")) {
      v1base = raw;
    } else {
      v1base = `${raw}/v1`;
    }
    roots.add(hermesGatewayRootFromV1Base(v1base));
  }
  appendDefaultHermesGatewayRoots(roots);
  return [...roots];
}

export function getHermesAuthHeaders(): Record<string, string> {
  const key = process.env.API_SERVER_KEY?.trim() || process.env.HERMES_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function collectSkillListUrls(): string[] {
  const u = new Set<string>();
  const ex = process.env.HERMES_SKILLS_LIST_ENDPOINT?.trim();
  if (ex) {
    u.add(ex);
  }
  for (const r of getHermesGatewayRootsForSkills()) {
    u.add(`${stripTrailingSlash(r)}/api/skills`);
  }
  return [...u];
}

function collectSkillDetailUrls(id: string): string[] {
  const enc = encodeURIComponent(id);
  const u = new Set<string>();
  const ex = process.env.HERMES_SKILLS_DETAIL_ENDPOINT?.trim();
  if (ex) {
    u.add(`${ex}?id=${enc}`);
  }
  for (const r of getHermesGatewayRootsForSkills()) {
    u.add(`${stripTrailingSlash(r)}/api/skills/detail?id=${enc}`);
  }
  return [...u];
}

function collectSkillRegisterUrls(): string[] {
  const u = new Set<string>();
  const ex = process.env.HERMES_SKILLS_REGISTER_ENDPOINT?.trim();
  if (ex) {
    u.add(ex);
  }
  for (const r of getHermesGatewayRootsForSkills()) {
    u.add(`${stripTrailingSlash(r)}/api/skills/register`);
  }
  return [...u];
}

/** 单端点超时；多根地址并行探测，墙钟时间约等于本值而非累加。 */
const PER_URL_MS = 4_000;

function aggregateErrorMessage(e: unknown): string {
  if (e instanceof AggregateError) {
    return e.errors.map((x) => (x instanceof Error ? x.message : String(x))).join("；");
  }
  if (e instanceof Error) return e.message;
  return "网络错误";
}

export async function fetchHermesRemoteSkillList(): Promise<
  | {
      list: unknown[];
      message?: string;
    }
  | null
> {
  const urls = collectSkillListUrls();
  if (!urls.length) {
    return null;
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...getHermesAuthHeaders(),
  };
  const attempts = urls.map(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(PER_URL_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} (${url})`);
    }
    const data = (await response.json()) as { list?: unknown[]; message?: string; ok?: boolean };
    if (!Array.isArray(data.list)) {
      throw new Error(data.message || "响应缺少 list 数组");
    }
    return { list: data.list, message: data.message };
  });
  try {
    return await Promise.any(attempts);
  } catch (e) {
    return { list: [], message: aggregateErrorMessage(e) || "无可用 Hermes 技能列表端点" };
  }
}

export async function fetchHermesRemoteSkillDetail(
  id: string,
): Promise<{ skill: unknown | null; message?: string } | null> {
  const urls = collectSkillDetailUrls(id);
  if (!urls.length) {
    return null;
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...getHermesAuthHeaders(),
  };
  const attempts = urls.map(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(PER_URL_MS),
    });
    if (response.status === 404) {
      throw new Error("not found");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { skill?: unknown; message?: string; ok?: boolean };
    if (data.skill) {
      return { skill: data.skill, message: data.message };
    }
    throw new Error(data.message || "响应缺少 skill");
  });
  try {
    return await Promise.any(attempts);
  } catch (e) {
    return { skill: null, message: aggregateErrorMessage(e) };
  }
}

export async function postHermesRemoteSkillRegister(body: Record<string, unknown>): Promise<{
  ok: boolean;
  skillId?: string;
  version?: string;
  message?: string;
} | null> {
  const urls = collectSkillRegisterUrls();
  if (!urls.length) {
    return null;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...getHermesAuthHeaders(),
  };
  let lastMessage: string | undefined;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PER_URL_MS),
      });
      let data: { ok?: boolean; skillId?: string; version?: string; message?: string };
      try {
        data = (await response.json()) as typeof data;
      } catch {
        lastMessage = `HTTP ${response.status}（非 JSON）`;
        continue;
      }
      if (typeof data.ok === "boolean") {
        return {
          ok: data.ok,
          skillId: data.skillId,
          version: data.version,
          message: data.message,
        };
      }
      lastMessage = data.message || `HTTP ${response.status}`;
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : "网络错误";
    }
  }
  return { ok: false, message: lastMessage || "无可用 Hermes 注册端点" };
}
