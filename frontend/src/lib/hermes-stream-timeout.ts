/** 解析正整数毫秒；非法或未设置时用 fallback */
export function parsePositiveMs(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/** 建立 Hermes SSE 连接阶段（含多 endpoint 探测）最长时间 */
export function hermesStreamConnectTimeoutMs(): number {
  return parsePositiveMs(process.env.HERMES_STREAM_CONNECT_TIMEOUT_MS, 300_000);
}

/** 已建立连接后，连续无字节的最长空闲时间（多轮工具/MinerU 长任务） */
export function hermesStreamIdleTimeoutMs(): number {
  return parsePositiveMs(process.env.HERMES_STREAM_IDLE_TIMEOUT_MS, 3_600_000);
}

/** 单轮流式读取总时长上限 */
export function hermesStreamMaxDurationMs(): number {
  return parsePositiveMs(process.env.HERMES_STREAM_MAX_DURATION_MS, 7_200_000);
}

/** BFF 在等待 Hermes 上游时向前端推送 turn.heartbeat 的间隔（避免长时间无事件像卡死） */
export function hermesSseClientHeartbeatMs(): number {
  return parsePositiveMs(process.env.HERMES_SSE_CLIENT_HEARTBEAT_MS, 20_000);
}

/**
 * 对 ReadableStreamDefaultReader.read() 增加空闲超时；每次成功读到数据会重置空闲计时。
 */
export async function readStreamChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
  startedAt: number,
  maxMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (Date.now() - startedAt > maxMs) {
    throw new Error(`Hermes 流总时长超过 ${Math.round(maxMs / 60_000)} 分钟`);
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        idleTimer = setTimeout(() => {
          reject(
            new Error(
              `Hermes 流空闲超过 ${Math.round(idleMs / 60_000)} 分钟（无 SSE 数据）；若任务仍在执行可点重试`,
            ),
          );
        }, idleMs);
      }),
    ]);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
