/**
 * 技能列表 / 详情 API 的浏览器端缓存（sessionStorage + TTL），减轻 Hermes 慢路径的重复等待。
 * 仅缓存远端接口形态数据；与 `loadLocalSkills()` 的合并仍由调用方负责。
 */
import type { Skill } from "@/components/skills/types";
import { getDataScopeUserId } from "@/lib/client-data-scope";

function listCacheKey() {
  const sub = getDataScopeUserId() ?? "__guest__";
  return `xingyan.skills.api.list.v1::${sub}`;
}

function detailKey(id: string) {
  const sub = getDataScopeUserId() ?? "__guest__";
  return `xingyan.skills.api.detail.v1::${sub}::${id}`;
}
/** 列表：Hermes 目录变更不频繁，略短 TTL 平衡新鲜度与体感 */
const LIST_TTL_MS = 3 * 60 * 1000;
/** 详情：含 SKILL 正文，可略长 */
const DETAIL_TTL_MS = 5 * 60 * 1000;
/** 单条详情缓存体积上限（字符），避免撑爆 sessionStorage */
const DETAIL_JSON_MAX_CHARS = 1_800_000;

type ListPayload = { at: number; list: Skill[] };
type DetailPayload = { at: number; skill: Skill };

function safeParse<T>(raw: string | null): T | null {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 原始 API 列表（未与本地合并） */
export function getCachedSkillsApiList(): Skill[] | null {
  if (typeof window === "undefined") return null;
  const p = safeParse<ListPayload>(storageGet(listCacheKey()));
  if (!p || !Array.isArray(p.list) || typeof p.at !== "number") return null;
  if (Date.now() - p.at > LIST_TTL_MS) return null;
  return p.list;
}

export function setCachedSkillsApiList(list: Skill[]) {
  if (typeof window === "undefined") return;
  const payload: ListPayload = { at: Date.now(), list };
  const text = JSON.stringify(payload);
  if (text.length > 4_500_000) return;
  storageSet(listCacheKey(), text);
}

export function invalidateSkillsListCache() {
  storageRemove(listCacheKey());
}

export function getCachedSkillDetail(normalizedId: string): Skill | null {
  if (typeof window === "undefined") return null;
  const p = safeParse<DetailPayload>(storageGet(detailKey(normalizedId)));
  if (!p || !p.skill || typeof p.at !== "number") return null;
  if (Date.now() - p.at > DETAIL_TTL_MS) return null;
  return p.skill;
}

export function setCachedSkillDetail(normalizedId: string, skill: Skill) {
  if (typeof window === "undefined") return;
  const payload: DetailPayload = { at: Date.now(), skill };
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return;
  }
  if (text.length > DETAIL_JSON_MAX_CHARS) return;
  storageSet(detailKey(normalizedId), text);
}

export function invalidateSkillDetailCache(normalizedId: string) {
  storageRemove(detailKey(normalizedId));
}

/** 上传 / 注册后使列表与单条详情缓存失效（本地条目已变） */
export function invalidateSkillsCachesForListAndDetail(normalizedDetailId?: string) {
  invalidateSkillsListCache();
  if (normalizedDetailId) invalidateSkillDetailCache(normalizedDetailId);
}

/** 始终打远端；成功后写入列表缓存。供技能中心后台刷新、ChatInput 对齐等复用。 */
export async function fetchSkillsApiListFromNetwork(): Promise<{ list: Skill[]; ok: boolean }> {
  try {
    const res = await fetch("/api/skills/list", { cache: "no-store" });
    if (!res.ok) return { list: [], ok: false };
    const data = (await res.json()) as { list?: Skill[] };
    const list = Array.isArray(data.list) ? data.list : [];
    setCachedSkillsApiList(list);
    return { list, ok: true };
  } catch {
    return { list: [], ok: false };
  }
}
