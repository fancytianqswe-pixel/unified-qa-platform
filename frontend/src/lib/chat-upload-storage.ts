import { randomUUID } from "crypto";
import { access, mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";

/** 单文件上限（字节），可通过环境变量覆盖 */
export function getChatUploadMaxBytes(): number {
  const raw = process.env.CHAT_UPLOAD_MAX_BYTES?.trim();
  if (!raw) return 80 * 1024 * 1024;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 512 * 1024 * 1024) : 80 * 1024 * 1024;
}

/**
 * Next 进程写入目录。默认：`~/.hermes/chat-uploads`，与 Hermes 网关
 * `~/.hermes:/opt/data` 挂载一致，网关在容器内读 `/opt/data/chat-uploads/...`。
 * 生产可设为共享盘绝对路径（须与网关挂载对齐）。
 */
export function getChatUploadRoot(): string {
  const env = process.env.CHAT_UPLOAD_DIR?.trim();
  if (env) return path.resolve(env);
  return path.join(homedir(), ".hermes", "chat-uploads");
}

/** 网关在容器内看到的绝对路径前缀（与 CHAT_UPLOAD_DIR 的挂载目标一致） */
export function getHermesChatUploadPathPrefix(): string {
  const p = (process.env.CHAT_UPLOAD_HERMES_PATH_PREFIX ?? "/opt/data/chat-uploads").trim().replace(/\/+$/, "");
  return p || "/opt/data/chat-uploads";
}

/** 落盘文件名：单层 basename + 字符白名单，防路径穿越 */
export function safeStoredFileName(original: string): string {
  const base = path.basename(original || "upload").replace(/\s+/g, " ").trim() || "upload";
  const cleaned = base.replace(/[^\w.\-\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, "_");
  const limited = cleaned.slice(0, 180);
  return limited || "upload.bin";
}

export function attachmentAbsolutePath(uploadId: string, storedFileName: string): string {
  const id = path.basename(uploadId);
  const file = path.basename(safeStoredFileName(storedFileName));
  return path.join(getChatUploadRoot(), id, file);
}

export function hermesAbsolutePathForAttachment(uploadId: string, storedFileName: string): string {
  const id = path.basename(uploadId);
  const file = path.basename(safeStoredFileName(storedFileName));
  return `${getHermesChatUploadPathPrefix()}/${id}/${file}`;
}

export async function ensureAttachmentFileExists(uploadId: string, storedFileName: string): Promise<boolean> {
  try {
    await access(attachmentAbsolutePath(uploadId, storedFileName));
    return true;
  } catch {
    return false;
  }
}

export type SavedChatAttachment = {
  attachmentId: string;
  displayName: string;
  storedFileName: string;
  sizeBytes: number;
  hermesPath: string;
};

export async function saveChatUploadToDisk(
  file: File,
): Promise<{ ok: true; data: SavedChatAttachment } | { ok: false; status: number; message: string }> {
  const max = getChatUploadMaxBytes();
  if (file.size > max) {
    return { ok: false, status: 413, message: `文件过大，上限 ${Math.round(max / (1024 * 1024))}MB` };
  }
  const attachmentId = randomUUID();
  const storedFileName = safeStoredFileName(file.name);
  const displayName = path.basename(file.name || "未命名文件").slice(0, 240) || "未命名文件";
  const dir = path.join(getChatUploadRoot(), attachmentId);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, storedFileName);

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > max) {
    return { ok: false, status: 413, message: `文件过大，上限 ${Math.round(max / (1024 * 1024))}MB` };
  }

  await writeFile(dest, buf);

  const hermesPath = hermesAbsolutePathForAttachment(attachmentId, storedFileName);
  return {
    ok: true,
    data: {
      attachmentId,
      displayName,
      storedFileName,
      sizeBytes: buf.length,
      hermesPath,
    },
  };
}
