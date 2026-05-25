/**
 * 技能详情动态路由 `[id]` 与查询参数 `?id=` 的规范化（避免多次编码或 `%3A` 导致与 Hermes / 内置 id 对不齐）。
 */
export function normalizeSkillDetailRouteId(raw: string): string {
  let s = String(raw ?? "").trim();
  if (!s) return s;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s;
}
