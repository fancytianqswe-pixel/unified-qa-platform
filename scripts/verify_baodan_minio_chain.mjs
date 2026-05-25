/**
 * 校验：MinIO 可列对象 + MySQL 三列与桶/前缀一致（与 BFF 使用同一套 MINIO_* / MYSQL_*）。
 * 用法（仓库根）：先 `Get-Content frontend/.env.local` 导出到环境，或手动设 MINIO_* 后
 *   node scripts/verify_baodan_minio_chain.mjs [报账单号]
 */
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const mysql = require("mysql2/promise");

function loadDotLocal() {
  const p = path.join(REPO_ROOT, "frontend", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function normalizeEndpoint(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, "");
  const ssl = /^1|true|yes$/i.test(String(process.env.MINIO_USE_SSL ?? "").trim());
  return `${ssl ? "https" : "http"}://${t.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

async function main() {
  loadDotLocal();
  const billNo = (process.argv[2] || "TYA01102040000312510100610").trim();
  const ep = normalizeEndpoint(process.env.MINIO_ENDPOINT ?? "");
  const ak = process.env.MINIO_ACCESS_KEY?.trim();
  const sk = process.env.MINIO_SECRET_KEY?.trim();
  const bucket = process.env.MINIO_BUCKET?.trim();
  const root = (process.env.MINIO_OBJECT_ROOT?.trim() || "报账单").replace(/^\/+|\/+$/g, "") || "报账单";
  const region = process.env.MINIO_REGION?.trim() || "us-east-1";
  const forcePath = !/^0|false|no$/i.test(String(process.env.MINIO_FORCE_PATH_STYLE ?? "true").trim());

  if (!ep || !ak || !sk || !bucket) {
    console.error("缺少 MINIO_*（可先配置 frontend/.env.local）");
    process.exit(1);
  }

  const prefix = `${root}/${billNo}/`;
  const client = new S3Client({
    region,
    endpoint: ep,
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    forcePathStyle: forcePath,
  });
  const list = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 50 })
  );
  const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean);
  console.log("MinIO:", bucket, "前缀", prefix, "→ 命中", keys.length, "个对象（最多展示 50）");
  keys.slice(0, 5).forEach((k) => console.log("  ", k));

  const host = process.env.MYSQL_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.MYSQL_PORT?.trim() || "3307");
  const user = process.env.MYSQL_USER?.trim() || "root";
  const password = process.env.MYSQL_PASSWORD ?? "Root#2026!AiCursor";
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: "qa_test_baodan",
  });
  const [rows] = await conn.execute(
    "SELECT `报账单号`, `附件存储类型`, `附件存储桶`, `附件对象前缀` FROM `reimbursement_bills` WHERE `报账单号` = ?",
    [billNo]
  );
  await conn.end();
  const row = rows[0];
  if (!row) {
    console.error("MySQL: 无此报账单号", billNo);
    process.exit(1);
  }
  console.log("MySQL:", row["报账单号"], row["附件存储类型"], row["附件存储桶"], row["附件对象前缀"]);
  const ok =
    row["附件存储类型"] === "minio" &&
    row["附件存储桶"] === bucket &&
    row["附件对象前缀"] === prefix &&
    keys.length > 0;
  console.log(ok ? "\n结论：桶可列对象且库表宣告一致，BFF 在配置 MINIO_* 且带 baodanStageBillNo 时应能拉到 chat-uploads。" : "\n结论：请检查缺对象或库表前缀是否与 MINIO_OBJECT_ROOT 一致。");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
