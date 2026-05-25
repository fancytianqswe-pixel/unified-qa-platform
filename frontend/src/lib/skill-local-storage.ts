import type { Skill } from "@/components/skills/types";
import { scopedLocalStorageKey } from "@/lib/client-data-scope";

const STORAGE_KEY = "skills-center.local-skills.v1";

function storageKey() {
  return scopedLocalStorageKey(STORAGE_KEY);
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** 浏览器内通过「新技能 / 上传」写入的本地技能，合并进大厅列表（Hermes 未返回前可本地可见） */
export function loadLocalSkills(): Skill[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Skill[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalSkills(list: Skill[]) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list.slice(0, 80)));
  } catch {
    /* ignore quota */
  }
}

export function upsertLocalSkill(skill: Skill) {
  const cur = loadLocalSkills();
  const next = [skill, ...cur.filter((s) => s.id !== skill.id)];
  saveLocalSkills(next);
}
