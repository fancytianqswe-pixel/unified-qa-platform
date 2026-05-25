/**
 * 解码 URL 路径段中的 `%HH`；遇非法 `%` 序列（如单独 `%`、截断的 `%E0`）时返回原串，避免 `URIError` 拖垮 RSC/客户端渲染。
 */
export function safeDecodeURIComponent(input: string): string {
  const s = String(input ?? "");
  if (!s) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
