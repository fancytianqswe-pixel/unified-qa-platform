/**
 * 浏览器端「当前登录用户」数据隔离：同一浏览器多账号登录时，localStorage / persist 按用户 id 分桶。
 * 在登录成功或 `/api/auth/me` 确认会话后写入；退出登录时清除。
 */
const STORAGE_SUB_KEY = "xingyan_client_data_scope_sub";

export function getDataScopeUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_SUB_KEY);
  } catch {
    return null;
  }
}

export function setDataScopeUserId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(STORAGE_SUB_KEY, id);
    else localStorage.removeItem(STORAGE_SUB_KEY);
    window.dispatchEvent(new Event("xingyan-data-scope-changed"));
  } catch {
    /* ignore */
  }
}

/** 为 localStorage 主键增加用户分桶后缀（无登录态时用 __guest__，避免与已登录数据混写） */
export function scopedLocalStorageKey(baseKey: string): string {
  const sub = getDataScopeUserId();
  return sub ? `${baseKey}::user::${sub}` : `${baseKey}::user::__guest__`;
}
