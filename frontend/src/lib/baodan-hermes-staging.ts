import { existsSync } from "fs";
import { copyFile, mkdir, readdir, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { resolveBaodanBillNosFromConversation } from "@/lib/baodan-bill-no-parse";
import { isDataRuleAuditWizardRequest } from "@/lib/data-rule-audit-wizard";
import type { HermesTurnSkillLoadResult } from "@/lib/hermes-turn-skill-loader";
import { getChatUploadRoot, getHermesChatUploadPathPrefix } from "@/lib/chat-upload-storage";
import type { BaodanStageResult } from "@/lib/baodan-stage-types";
import { isMinioStagingConfigured, stageBillAttachmentsFromMinio } from "@/lib/minio-baodan-staging";

export type { BaodanStageResult } from "@/lib/baodan-stage-types";

/** 与导入脚本白名单一致：仅这些顶层子目录递归 */
const ATTACH_TOP_DIRS = new Set(["合同", "影像", "附件"]);
const NOISE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

const BILL_NO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/;
/** 同步失败时追加到用户轮次末尾，降低模型误用「任意 chat-uploads uuid + 另一单相对路径片段」调用 MinerU */
const AGENT_STAGING_PATH_GUARD =
  "【Agent】未出现本回合「报账单附件已由 BFF…」且列出该单完整 Linux 路径时，**禁止**调用 MinerU。**禁止**用本会话「用户上传」路径、`ls /opt/data/chat-uploads` 下**任意** uuid 去拼**另一单**的相对路径片段（如 `合同/xx.pdf`）；**每单独立** `chat-uploads/<uuid>/`。若同步失败，请提示运维核对：BFF 与对象存储的**网络可达性**、桶与前缀是否与库表一致、`CHAT_UPLOAD_DIR` 与 Hermes 将 `~/.hermes` 挂载到容器内 **`/opt/data`** 的约定是否一致；**禁止**假定「本机回环地址、仓库样例目录」等联调默认值。";
const MAX_FILES = 80;
const MAX_TOTAL_BYTES = 140 * 1024 * 1024;
const MAX_ONE_FILE_BYTES = 48 * 1024 * 1024;

type TurnBody = {
  context?: Record<string, string>;
  text?: string;
  blocks?: Array<{ type?: string; name?: string; skillId?: string }>;
  conversationHistory?: Array<{ role?: string; content?: string }>;
};

function stagingBillCap(): number {
  const n = Number(process.env.BAODAN_STAGE_MAX_BILLS?.trim());
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(10, Math.floor(n));
}

/**
 * 解析本轮要拉取的报账单号列表（去重，有上限）：`context.baodanStageBillNo` 支持逗号/空格分隔多个；
 * 再合并本轮 `text` 与 `conversationHistory`（由新到旧扫用户/助手消息）中出现的所有 `TYA…`。
 * 用于阶段 B：每单独立 staging 目录，避免复用阶段 A 的 `chat-uploads/<uuid>/` 去读另一单的相对路径。
 */
export function resolveBaodanBillNosForStaging(body: TurnBody, maxOverride?: number): string[] {
  const limit = maxOverride ?? stagingBillCap();
  return resolveBaodanBillNosFromConversation({
    contextBaodanStageBillNo: body.context?.baodanStageBillNo,
    text: body.text,
    conversationHistory: body.conversationHistory,
    maxBills: limit,
  });
}

/** 仅取一单（兼容旧逻辑）：等价于 `resolveBaodanBillNosForStaging(body, 1)[0]`。 */
export function resolveBaodanBillNoForStaging(body: TurnBody): string {
  return resolveBaodanBillNosForStaging(body, 1)[0] ?? "";
}

function isNoiseFileName(name: string): boolean {
  return NOISE_NAMES.has(name.trim().toLowerCase());
}

/** 解析含 `test/报账单` 的仓库根（与 import 脚本一致） */
export function resolveRepoRootForBaodanSync(): string | null {
  const env = process.env.REPO_ROOT?.trim() || process.env.BAODAN_REPO_ROOT?.trim();
  const candidates = [
    env ? path.resolve(env) : null,
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter(Boolean) as string[];
  for (const root of candidates) {
    try {
      if (existsSync(path.join(root, "test", "报账单"))) return root;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function collectWhitelistRelPaths(billRootAbs: string): Promise<string[]> {
  const root = path.resolve(billRootAbs);
  const rels: string[] = [];

  async function walkUnder(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (isNoiseFileName(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walkUnder(full);
      else if (ent.isFile()) {
        rels.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }

  const top = await readdir(root, { withFileTypes: true });
  for (const ent of top) {
    if (isNoiseFileName(ent.name)) continue;
    const full = path.join(root, ent.name);
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".json")) {
      rels.push(ent.name);
    } else if (ent.isDirectory() && ATTACH_TOP_DIRS.has(ent.name)) {
      await walkUnder(full);
    }
  }
  return rels.sort();
}

/**
 * 将仓库 `test/报账单/<报账单号>/` 下白名单文件复制到 CHAT_UPLOAD_DIR（默认 ~/.hermes/chat-uploads），
 * 与 Hermes `~/.hermes:/opt/data` 挂载对齐，使 MinerU 可使用 `/opt/data/chat-uploads/<stagingId>/...` 读盘。
 */
export async function stageBaodanBillToHermesUploads(billNo: string): Promise<BaodanStageResult> {
  if (!BILL_NO_RE.test(billNo)) {
    return { ok: false, message: "报账单号格式无效（仅字母数字与少量安全符号）。" };
  }
  const repoRoot = resolveRepoRootForBaodanSync();
  if (!repoRoot) {
    return {
      ok: false,
      message: "未找到仓库下的 test/报账单 目录。请在 Next 进程设置 REPO_ROOT 指向仓库根，或从仓库根/frontend 目录启动 dev。",
    };
  }
  const billRoot = path.join(repoRoot, "test", "报账单", billNo);
  try {
    const st = await stat(billRoot);
    if (!st.isDirectory()) return { ok: false, message: `路径不是目录：${billRoot}` };
  } catch {
    return { ok: false, message: `未找到报账单目录：test/报账单/${billNo}/` };
  }

  const rels = await collectWhitelistRelPaths(billRoot);
  if (!rels.length) {
    return { ok: false, message: `目录下无白名单内文件（根层 json + 合同/影像/附件）：${billNo}` };
  }
  if (rels.length > MAX_FILES) {
    return { ok: false, message: `文件过多（>${MAX_FILES}），请缩小样例或联系管理员调大上限。` };
  }

  let total = 0;
  for (const rel of rels) {
    const src = path.join(billRoot, ...rel.split("/"));
    try {
      const s = await stat(src);
      if (!s.isFile()) continue;
      if (s.size > MAX_ONE_FILE_BYTES) {
        return { ok: false, message: `单文件过大（>${Math.round(MAX_ONE_FILE_BYTES / (1024 * 1024))}MB）：${rel}` };
      }
      total += s.size;
      if (total > MAX_TOTAL_BYTES) {
        return { ok: false, message: `总大小超过 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB，未执行同步。` };
      }
    } catch {
      return { ok: false, message: `无法读取：${rel}` };
    }
  }

  const stagingId = randomUUID();
  const hostDir = path.join(getChatUploadRoot(), stagingId);
  const hermesPrefix = getHermesChatUploadPathPrefix().replace(/\/+$/, "");
  const lines: string[] = [];

  for (const rel of rels) {
    const src = path.join(billRoot, ...rel.split("/"));
    const dest = path.join(hostDir, ...rel.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    const posixRel = rel.split(path.sep).join("/");
    const hermesPath = `${hermesPrefix}/${stagingId}/${posixRel.split("/").join("/")}`;
    lines.push(`- ${hermesPath}（相对路径：${posixRel}）`);
  }

  const uuidHint =
    `\n\n【判据】staging 目录名为**随机 UUID**，路径字符串里**不会出现** \`TYA…\` 报账单号；在 \`/opt/data/chat-uploads\` 下执行 \`find … *TYA*\` **必然为空**，属正常，**不能**据此声称「BFF 未注入」。是否已注入以**本轮发往模型的用户合并文本**末尾是否含 **「报账单附件已由 BFF…」** 及下列完整路径为准；若 Hermes 工具只能看磁盘，也可用 \`ls <上列路径所在目录>\` 核对文件是否存在。`;

  const directive =
    `\n\n【报账单附件已由 BFF 同步至 Hermes 可读目录】` +
    `报账单号 \`${billNo}\`；共 ${rels.length} 个文件。下列 **Linux 风格绝对路径** 与网关容器内 \`${hermesPrefix}/\` 挂载一致，` +
    `**请仅使用这些路径** 调用 MinerU（或读文件），**禁止**使用库表预览中的 Windows 路径、禁止拼接 \`/mnt/c\` 或盲扫盘。\n` +
    lines.join("\n") +
    uuidHint;

  return { ok: true, directive, copiedFiles: rels.length, stagingId };
}

export async function maybeBuildBaodanStagingSuffix(
  body: TurnBody,
  skillLoad: HermesTurnSkillLoadResult | null,
): Promise<string> {
  if (!isDataRuleAuditWizardRequest(body, skillLoad)) return "";
  const billNos = resolveBaodanBillNosForStaging(body);
  if (!billNos.length) return "";

  if (isMinioStagingConfigured()) {
    const fallback = /^1|true|yes$/i.test(String(process.env.BAODAN_STAGE_FALLBACK_REPO ?? "").trim());
    const parts: string[] = [];
    const errs: string[] = [];
    for (const billNo of billNos) {
      const minioRes = await stageBillAttachmentsFromMinio(billNo);
      if (minioRes.ok) {
        parts.push(minioRes.directive);
        continue;
      }
      if (fallback) {
        const local = await stageBaodanBillToHermesUploads(billNo);
        if (local.ok) {
          parts.push(
            `\n\n【对象存储同步失败（${billNo}），已使用备选介质】${minioRes.message}\n${local.directive}`,
          );
          continue;
        }
        errs.push(`${billNo}：对象存储 ${minioRes.message}；备选介质 ${local.message}`);
        continue;
      }
      errs.push(`${billNo}：${minioRes.message}`);
    }
    if (parts.length) {
      if (errs.length) {
        parts.push(
          `\n\n【部分报账单未拉取】${errs.join("；")}\n\n${AGENT_STAGING_PATH_GUARD}`,
        );
      }
      return parts.join("");
    }
    if (errs.length) {
      return `\n\n【对象存储附件同步失败】${errs.join("；")}\n\n${AGENT_STAGING_PATH_GUARD}`;
    }
    return "";
  }

  const parts: string[] = [];
  const errs: string[] = [];
  for (const billNo of billNos) {
    const r = await stageBaodanBillToHermesUploads(billNo);
    if (r.ok) parts.push(r.directive);
    else errs.push(`${billNo}：${r.message}`);
  }
  if (parts.length) {
    if (errs.length) {
      parts.push(`\n\n【部分报账单同步失败】${errs.join("；")}\n\n${AGENT_STAGING_PATH_GUARD}`);
    }
    return parts.join("");
  }
  return `\n\n【报账单附件同步失败】${errs.join("；")}\n\n${AGENT_STAGING_PATH_GUARD}`;
}
