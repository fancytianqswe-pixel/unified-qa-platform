/** 对话/展示用密码掩码，不能用于真实 MySQL 探测 */
export function isDatasourcePasswordPlaceholder(password: string | undefined | null): boolean {
  const s = String(password ?? "").trim();
  if (!s) return true;
  if (s === "***" || s === "******" || s === "•••" || s === "······") return true;
  if (/^[*•·.]{3,}$/.test(s)) return true;
  return false;
}
