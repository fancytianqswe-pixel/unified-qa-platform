/**
 * 为 qa_test_baodan.reimbursement_bills 已有行写入对象存储三列（附件存储类型 / 附件存储桶 / 附件对象前缀）。
 * 不依赖各单号目录下的 *.json 源文件（与 import_qa_test_baodan.mjs 区分）。
 *
 * 环境变量：
 *   MINIO_BUCKET（必填，如 baodan-attachments）
 *   MINIO_OBJECT_ROOT（可选，默认 报账单）
 *   MYSQL_* 同 import 脚本
 *
 * 用法：在仓库根
 *   MINIO_BUCKET=baodan-attachments node scripts/patch_baodan_minio_columns.mjs
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const mysql = require("mysql2/promise");

const host = process.env.MYSQL_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.MYSQL_PORT?.trim() || "3307");
const user = process.env.MYSQL_USER?.trim() || "root";
const password = process.env.MYSQL_PASSWORD ?? "Root#2026!AiCursor";

const bucket = (process.env.MINIO_BUCKET ?? "").trim();
const objectRoot =
  (process.env.MINIO_OBJECT_ROOT?.trim() || "报账单").replace(/^\/+|\/+$/g, "") || "报账单";

async function main() {
  if (!bucket) {
    console.error("请设置 MINIO_BUCKET（与 docker-compose / .env.local 一致）");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: "qa_test_baodan",
  });

  const [rows] = await conn.query("SELECT `报账单号` FROM `reimbursement_bills`");
  let n = 0;
  for (const row of rows) {
    const billNo = row["报账单号"];
    const prefix = `${objectRoot}/${billNo}/`;

    await conn.execute(
      "UPDATE `reimbursement_bills` SET `附件存储类型` = ?, `附件存储桶` = ?, `附件对象前缀` = ? WHERE `报账单号` = ?",
      ["minio", bucket, prefix, billNo]
    );
    n += 1;
    console.log("已更新:", billNo);
  }

  await conn.end();
  console.log("完成。共", n, "行。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
