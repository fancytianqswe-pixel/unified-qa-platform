import { scopedLocalStorageKey } from "@/lib/client-data-scope";

const STORAGE_KEY = "skills-center.subscriptions.v1";

function storageKey() {
  return scopedLocalStorageKey(STORAGE_KEY);
}

function readMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === "object" ? (o as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function isSkillSubscribed(skillId: string): boolean {
  return !!readMap()[skillId];
}

export function setSkillSubscribed(skillId: string, value: boolean) {
  if (typeof window === "undefined") return;
  const map = readMap();
  if (value) map[skillId] = true;
  else delete map[skillId];
  try {
    localStorage.setItem(storageKey(), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
