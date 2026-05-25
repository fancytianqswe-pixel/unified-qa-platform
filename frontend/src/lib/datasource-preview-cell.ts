/**
 * 数据源「获取数据」预览格：避免 object 被 String() 成 "[object Object]"。
 */
export function formatDatasourcePreviewCell(v: unknown, maxLen = 320): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v, null, 0);
      return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
    } catch {
      return "-";
    }
  }
  const s = String(v);
  if (s === "") return "-";
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}
