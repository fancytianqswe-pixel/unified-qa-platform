/**
 * 从 Hermes Gateway 拉取 Cron 任务列表（与 API Server 的 GET /api/jobs 对齐）。
 */

import { appendDefaultHermesGatewayRoots } from "@/lib/hermes-default-gateway-roots";
import { fetchTimeoutSignal } from "@/lib/fetch-timeout-signal";
import { getHermesAuthHeaders, hermesGatewayRootFromV1Base } from "@/lib/hermes-skills-client";

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function gatewayRoots(): string[] {
  const roots = new Set<string>();
  const gw = process.env.HERMES_GATEWAY_URL?.trim();
  if (gw) roots.add(stripTrailingSlash(gw));
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
    roots.add(stripTrailingSlash(hermesGatewayRootFromV1Base(v1base)));
  }
  appendDefaultHermesGatewayRoots(roots);
  return [...roots];
}

function collectJobsListUrls(): string[] {
  const ex = process.env.HERMES_JOBS_LIST_ENDPOINT?.trim();
  if (ex) {
    const sep = ex.includes("?") ? "&" : "?";
    return [`${ex}${sep}include_disabled=true`];
  }
  return gatewayRoots().map((r) => `${r}/api/jobs?include_disabled=true`);
}

const PER_URL_MS = 6_000;

function safeUrlLabel(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.length > 64 ? `${url.slice(0, 64)}…` : url;
  }
}

export type HermesJobsListResult =
  | { ok: true; jobs: unknown[]; sourceUrl?: string }
  | { ok: false; jobs: []; message: string };

export async function fetchHermesJobsList(): Promise<HermesJobsListResult> {
  const urls = collectJobsListUrls();
  if (!urls.length) {
    return { ok: false, jobs: [], message: "未配置 Hermes Gateway 地址" };
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...getHermesAuthHeaders(),
  };
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: fetchTimeoutSignal(PER_URL_MS),
        cache: "no-store",
      });
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        errors.push(`${safeUrlLabel(url)}: 非 JSON 响应`);
        continue;
      }
      if (res.status === 501) {
        const msg =
          typeof data === "object" && data && "error" in data
            ? String((data as { error?: unknown }).error)
            : "Cron 模块不可用";
        return { ok: false, jobs: [], message: msg };
      }
      if (!res.ok) {
        const err =
          typeof data === "object" && data && "error" in data
            ? String((data as { error?: unknown }).error)
            : `HTTP ${res.status}`;
        errors.push(`${safeUrlLabel(url)}: ${err}`);
        continue;
      }
      const jobs =
        typeof data === "object" && data !== null && "jobs" in data && Array.isArray((data as { jobs: unknown }).jobs)
          ? (data as { jobs: unknown[] }).jobs
          : [];
      return { ok: true, jobs, sourceUrl: url.split("?")[0] };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return {
    ok: false,
    jobs: [],
    message: errors.length ? errors.join("；") : "无法连接 Hermes Gateway",
  };
}
