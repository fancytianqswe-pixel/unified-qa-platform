/**
 * 【存量】就地清洗 qa_test_baodan.reimbursement_bills.附件索引：删除旧版字段「根目录」「绝对路径列表」，
 * 并在缺少「索引说明」时补全。若表已无「附件索引」列，本脚本直接退出。
 *
 * 用法（仓库根）：
 *   node scripts/strip_legacy_baodan_attach_index.mjs
 *
 * 连接：MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD（默认同 import_qa_test_baodan.mjs）
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

const 说明无Minio =
  "本 JSON 不含「根目录」「绝对路径列表」。Hermes/MinerU 须用 BFF 注入的 chat-uploads 路径或用户上传；勿把本列 JSON 当容器内读盘路径。";
const 说明有Minio =
  "已声明对象存储。Agent 取附件须以表列「附件存储类型 / 附件存储桶 / 附件对象前缀」及 BFF 注入的 chat-uploads 路径为准；本 JSON 仅含相对路径与业务分类，不含宿主机绝对路径。";

function normalizeIndex(raw) {
  let idx = raw;
  if (idx == null) return null;
  if (typeof idx === "string") {
    try {
      idx = JSON.parse(idx);
    } catch {
      return null;
    }
  }
  if (typeof idx !== "object" || Array.isArray(idx)) return null;

  const hadLegacy =
    Object.prototype.hasOwnProperty.call(idx, "根目录") ||
    Object.prototype.hasOwnProperty.call(idx, "绝对路径列表");

  delete idx["根目录"];
  delete idx["绝对路径列表"];

  let need说明 = !idx["索引说明"];
  if (need说明) {
    idx["索引说明"] = idx["对象存储"] ? 说明有Minio : 说明无Minio;
  }

  return { idx, changed: hadLegacy || need说明 };
}

async function main() {
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: "qa_test_baodan",
  });

  const [colRows] = await conn.query(
    "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reimbursement_bills' AND COLUMN_NAME = '附件索引'"
  );
  const col = colRows[0];
  if (!col || Number(col.c) === 0) {
    console.log("表 reimbursement_bills 无「附件索引」列，跳过（新库已删列）。");
    await conn.end();
    return;
  }

  const [rows] = await conn.query(
    "SELECT `报账单号`, `附件索引` FROM `reimbursement_bills` WHERE `附件索引` IS NOT NULL"
  );

  let updated = 0;
  for (const row of rows) {
    const out = normalizeIndex(row["附件索引"]);
    if (!out || !out.changed) continue;
    await conn.execute("UPDATE `reimbursement_bills` SET `附件索引` = CAST(? AS JSON) WHERE `报账单号` = ?", [
      JSON.stringify(out.idx),
      row["报账单号"],
    ]);
    updated += 1;
    console.log("已更新:", row["报账单号"]);
  }

  await conn.end();
  console.log("完成。共更新", updated, "行（其余行无需变更或附件索引为空）。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
