import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getChatUploadRoot, getHermesChatUploadPathPrefix } from "@/lib/chat-upload-storage";
import type { BaodanStageResult } from "@/lib/baodan-stage-types";

/** 与本地白名单一致：对象键在「报账单号/」下的相对路径规则 */
const ATTACH_TOP_DIRS = new Set(["合同", "影像", "附件"]);
const NOISE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

const BILL_NO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/;

const MAX_FILES = 80;
const MAX_TOTAL_BYTES = 140 * 1024 * 1024;
const MAX_ONE_FILE_BYTES = 48 * 1024 * 1024;

function isNoiseBase(name: string): boolean {
  return NOISE_NAMES.has(name.trim().toLowerCase());
}

/** 相对「报账单号/」目录的路径是否允许（根层仅 json；子目录仅 合同/影像/附件） */
function isWhitelistRelToBill(rel: string): boolean {
  const r = rel.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!r || r.endsWith("/")) return false;
  const base = path.posix.basename(r);
  if (isNoiseBase(base)) return false;
  const parts = r.split("/").filter(Boolean);
  if (parts.length === 1) return parts[0]!.toLowerCase().endsWith(".json");
  return ATTACH_TOP_DIRS.has(parts[0]!);
}

function normalizeEndpoint(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, "");
  const ssl = /^1|true|yes$/i.test(String(process.env.MINIO_USE_SSL ?? "").trim());
  return `${ssl ? "https" : "http"}://${t.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

export function isMinioStagingConfigured(): boolean {
  const ep = process.env.MINIO_ENDPOINT?.trim();
  const ak = process.env.MINIO_ACCESS_KEY?.trim();
  const sk = process.env.MINIO_SECRET_KEY?.trim();
  const bucket = process.env.MINIO_BUCKET?.trim();
  return Boolean(ep && ak && sk && bucket);
}

function createS3ClientForMinio(): S3Client {
  const endpoint = normalizeEndpoint(process.env.MINIO_ENDPOINT ?? "");
  const region = process.env.MINIO_REGION?.trim() || "us-east-1";
  const forcePath =
    !/^0|false|no$/i.test(String(process.env.MINIO_FORCE_PATH_STYLE ?? "true").trim());
  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY!.trim(),
      secretAccessKey: process.env.MINIO_SECRET_KEY!.trim(),
    },
    forcePathStyle: forcePath,
  });
}

function objectRootPrefix(): string {
  const root = (process.env.MINIO_OBJECT_ROOT?.trim() || "报账单").replace(/^\/+|\/+$/g, "");
  return root || "报账单";
}

function listPrefixForBill(billNo: string): string {
  const root = objectRootPrefix();
  return `${root}/${billNo}/`;
}

/**
 * 从 MinIO（S3 兼容）按前缀 `MINIO_OBJECT_ROOT/<报账单号>/` 列出对象，过滤白名单后下载到 chat-uploads，
 * 生成与本地同步相同的 Hermes 路径指令。
 */
export async function stageBillAttachmentsFromMinio(billNo: string): Promise<BaodanStageResult> {
  if (!isMinioStagingConfigured()) {
    return { ok: false, message: "未配置 MinIO（需 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET）。" };
  }
  if (!BILL_NO_RE.test(billNo)) {
    return { ok: false, message: "报账单号格式无效。" };
  }

  const bucket = process.env.MINIO_BUCKET!.trim();
  const prefix = listPrefixForBill(billNo);
  const client = createS3ClientForMinio();

  const objects: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 500,
      }),
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key || o.Key.endsWith("/")) continue;
      const rel = o.Key.startsWith(prefix) ? o.Key.slice(prefix.length) : "";
      if (!rel || !isWhitelistRelToBill(rel)) continue;
      objects.push({ key: o.Key, size: o.Size ?? 0 });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    if (objects.length >= MAX_FILES) break;
  } while (token);

  const trimmed = objects.slice(0, MAX_FILES);
  if (!trimmed.length) {
    return {
      ok: false,
      message: `MinIO 桶 \`${bucket}\` 前缀 \`${prefix}\` 下没有符合白名单的对象（可选根层 *.json；以及 合同/影像/附件/）。`,
    };
  }

  let total = 0;
  for (const o of trimmed) {
    if (o.size > MAX_ONE_FILE_BYTES) {
      return { ok: false, message: `单对象过大（>${Math.round(MAX_ONE_FILE_BYTES / (1024 * 1024))}MB）：${o.key}` };
    }
    total += o.size;
    if (total > MAX_TOTAL_BYTES) {
      return { ok: false, message: `总大小超过 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB，未执行同步。` };
    }
  }

  const stagingId = randomUUID();
  const hostDir = path.join(getChatUploadRoot(), stagingId);
  const hermesPrefix = getHermesChatUploadPathPrefix().replace(/\/+$/, "");
  const lines: string[] = [];

  for (const o of trimmed) {
    const rel = o.key.startsWith(prefix) ? o.key.slice(prefix.length) : o.key;
    const dest = path.join(hostDir, ...rel.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });

    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: o.key }));
    const body = out.Body;
    if (!body) {
      return { ok: false, message: `对象无正文：${o.key}` };
    }
    const buf = await body.transformToByteArray();
    await writeFile(dest, Buffer.from(buf));

    const posixRel = rel.split(path.sep).join("/");
    const hermesPath = `${hermesPrefix}/${stagingId}/${posixRel.split("/").join("/")}`;
    lines.push(`- ${hermesPath}（MinIO：${bucket}/${o.key}）`);
  }

  const uuidHint =
    `\n\n【判据】staging 目录名为**随机 UUID**，路径中**不含** \`TYA…\`；\`find /opt/data/chat-uploads -name '*TYA*'\` **恒为空**不代表未注入。以本轮用户合并消息末尾 **「报账单附件已由 BFF…」** 及下列路径为准。`;

  const directive =
    `\n\n【报账单附件已由 BFF 从 MinIO 拉取至 Hermes 可读目录】` +
    `报账单号 \`${billNo}\`；前缀 \`${prefix}\`；共 ${trimmed.length} 个对象。下列 **Linux 风格绝对路径** 与网关 \`${hermesPrefix}/\` 挂载一致，` +
    `**请仅使用这些路径** 调用 MinerU，**禁止**使用库表预览中的 Windows 路径或盲扫盘。\n` +
    lines.join("\n") +
    uuidHint;

  return { ok: true, directive, copiedFiles: trimmed.length, stagingId };
}
