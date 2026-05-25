/** 报账单附件同步到 chat-uploads / Hermes 可读路径的统一结果类型（本地仓库或 MinIO） */
export type BaodanStageResult =
  | { ok: true; directive: string; copiedFiles: number; stagingId: string }
  | { ok: false; message: string };
