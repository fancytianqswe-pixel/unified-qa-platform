/**
 * 将仓库 `test/报账单/<报账单号>/` 下白名单文件按目录结构上传到 MinIO（S3 兼容 API）。
 *
 * 用法（在仓库根）：
 *   node scripts/sync_baodan_to_minio.mjs
 *
 * 环境变量（必填）：
 *   MINIO_ENDPOINT       如 http://127.0.0.1:9000
 *   MINIO_ACCESS_KEY
 *   MINIO_SECRET_KEY
 *   MINIO_BUCKET         目标桶名（须已存在或具备建桶权限）
 *
 * 可选：
 *   MINIO_REGION         默认 us-east-1
 *   MINIO_FORCE_PATH_STYLE  默认 true（MinIO 常用）
 *   MINIO_USE_SSL        true 时对无协议的 endpoint 使用 https
 *   MINIO_OBJECT_ROOT    桶内根文件夹名，默认 `报账单` → 对象键 `报账单/<报账单号>/合同/...`
 *   BAODAN_ATTACH_ROOT   本地扫描根，默认 `<仓库根>/test/报账单`
 *   DRY_RUN=1            只打印将上传的键，不调用 PutObject
 *
 * 白名单与导入脚本一致：根层 *.json；子目录仅 合同/ 影像/ 附件/；跳过 .DS_Store 等噪声文件名。
 */
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const ATTACH_TOP = new Set(["合同", "影像", "附件"]);
const NOISE = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

function isNoise(name) {
  return NOISE.has(String(name).trim().toLowerCase());
}

function toPosixRel(baseAbs, fileAbs) {
  return path.relative(baseAbs, fileAbs).split(path.sep).join("/");
}

/** @returns {string[]} 相对 billRoot 的 POSIX 路径 */
function collectWhitelistRels(billRootAbs) {
  const root = path.resolve(billRootAbs);
  const rels = [];

  function walkUnder(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (isNoise(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walkUnder(full);
      else if (ent.isFile()) rels.push(toPosixRel(root, full));
    }
  }

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return rels;
  const top = fs.readdirSync(root, { withFileTypes: true });
  for (const ent of top) {
    if (isNoise(ent.name)) continue;
    const full = path.join(root, ent.name);
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".json")) {
      rels.push(toPosixRel(root, full));
    } else if (ent.isDirectory() && ATTACH_TOP.has(ent.name)) {
      walkUnder(full);
    }
  }
  return rels.sort();
}

function normalizeEndpoint(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, "");
  const ssl = /^1|true|yes$/i.test(String(process.env.MINIO_USE_SSL ?? "").trim());
  return `${ssl ? "https" : "http"}://${t.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

async function run() {
  const endpoint = normalizeEndpoint(process.env.MINIO_ENDPOINT);
  const ak = process.env.MINIO_ACCESS_KEY?.trim();
  const sk = process.env.MINIO_SECRET_KEY?.trim();
  const bucket = process.env.MINIO_BUCKET?.trim();
  if (!endpoint || !ak || !sk || !bucket) {
    console.error("缺少环境变量：MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET");
    process.exit(1);
  }

  const region = process.env.MINIO_REGION?.trim() || "us-east-1";
  const forcePath = !/^0|false|no$/i.test(String(process.env.MINIO_FORCE_PATH_STYLE ?? "true").trim());
  const objectRoot = (process.env.MINIO_OBJECT_ROOT?.trim() || "报账单").replace(/^\/+|\/+$/g, "") || "报账单";
  const attachRoot = (process.env.BAODAN_ATTACH_ROOT ?? "").trim()
    ? path.resolve(process.env.BAODAN_ATTACH_ROOT.trim())
    : path.join(REPO_ROOT, "test", "报账单");

  const dry = /^1|true|yes$/i.test(String(process.env.DRY_RUN ?? "").trim());

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    forcePathStyle: forcePath,
  });

  if (!fs.existsSync(attachRoot)) {
    console.error("本地目录不存在:", attachRoot);
    process.exit(1);
  }

  const bills = fs.readdirSync(attachRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  let count = 0;

  for (const d of bills) {
    const billNo = d.name;
    const billDir = path.join(attachRoot, billNo);
    const rels = collectWhitelistRels(billDir);
    if (!rels.length) {
      console.warn("跳过（无白名单文件）:", billNo);
      continue;
    }
    for (const rel of rels) {
      const key = `${objectRoot}/${billNo}/${rel.split(path.sep).join("/")}`;
      const abs = path.join(billDir, ...rel.split("/"));
      if (dry) {
        console.log("[DRY]", key);
        count += 1;
        continue;
      }
      const body = fs.readFileSync(abs);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: guessContentType(abs),
        }),
      );
      console.log("已上传:", key);
      count += 1;
    }
  }

  console.log(dry ? `DRY_RUN 结束，将上传 ${count} 个对象` : `完成。共 ${count} 个对象`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
