/**
 * 从头像展示名中取一个字符：优先首个汉字，否则首个拉丁字母（大写），否则首字符。
 */
export function getUserAvatarGlyph(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "?";
  const zh = t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/u);
  if (zh?.[0]) return zh[0];
  const lat = t.match(/[a-zA-Z]/);
  if (lat?.[0]) return lat[0].toUpperCase();
  const first = [...t][0];
  return first ?? "?";
}
