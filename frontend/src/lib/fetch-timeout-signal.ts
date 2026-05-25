/**
 * 服务端 / 客户端 fetch 超时：优先 `AbortSignal.timeout`；否则用 `AbortController` + `setTimeout` 兜底。
 */
export function fetchTimeoutSignal(ms: number): AbortSignal {
  const as = AbortSignal as unknown as { timeout?: (n: number) => AbortSignal };
  if (typeof as.timeout === "function") {
    return as.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
