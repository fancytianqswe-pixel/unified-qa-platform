import type { ContentBlock } from "@/components/chat/types";
import { ensureAttachmentFileExists, hermesAbsolutePathForAttachment } from "@/lib/chat-upload-storage";

const ATTACHMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 校验通过后拼进用户轮次，供 Hermes 侧工具直接读盘 */
export async function buildHermesAttachmentDirectiveForBlocks(blocks: unknown): Promise<string> {
  if (!Array.isArray(blocks)) return "";
  const lines: string[] = [];
  for (const raw of blocks) {
    const b = raw as ContentBlock;
    if (b.type !== "file_card") continue;
    const id = String((b as { attachmentId?: string }).attachmentId ?? "").trim();
    const stored = String((b as { storedFileName?: string }).storedFileName ?? "").trim();
    if (!id || !ATTACHMENT_ID_RE.test(id) || !stored) continue;
    const ok = await ensureAttachmentFileExists(id, stored);
    if (!ok) continue;
    const hermesPath = hermesAbsolutePathForAttachment(id, stored);
    const display = (b.name || stored).trim() || stored;
    lines.push(`- ${hermesPath}（展示名：${display}）`);
  }
  if (!lines.length) return "";
  return (
    "\n\n【附件】用户已通过本站上传文件，请在网关内使用以下绝对路径读取或解析（勿仅在会话里按文件名搜索）：\n" +
    lines.join("\n")
  );
}
