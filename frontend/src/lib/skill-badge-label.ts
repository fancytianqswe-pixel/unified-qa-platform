/** 网关返回的角标「Hermes」在统一质检平台 UI 中统一为「系统内置」 */
export function normalizeSkillBadgeLabel(label: string | undefined): string | undefined {
  if (label == null) return undefined;
  const t = String(label).trim();
  if (t === "Hermes") return "系统内置";
  return label;
}
