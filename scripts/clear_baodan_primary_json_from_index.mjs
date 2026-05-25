/**
 * 【存量】清洗 qa_test_baodan.reimbursement_bills.附件索引：去掉根层 *.json 与「业务分类.主数据」。
 * 若表已无「附件索引」列（见 docs/baodan_reimbursement_drop_legacy_attach_columns.sql），本脚本直接退出。
 *
 * 用法（仓库根）：
 *   node scripts/clear_baodan_primary_json_from_index.mjs
 *   DRY_RUN=1 node scripts/clear_baodan_primary_json_from_index.mjs
 *
 * 连接：MYSQL_* 同 import_qa_test_baodan.mjs
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

const dry = /^1|true|yes$/i.test(String(process.env.DRY_RUN ?? "").trim());

/** 根层 json：无 "/" 且以 .json 结尾 */
function isRootJsonRel(rel) {
  const s = String(rel ?? "").trim().replace(/\\/g, "/");
  if (!s || s.includes("/")) return false;
  return s.toLowerCase().endsWith(".json");
}

function cleanIndex(raw) {
  let idx = raw;
  if (idx == null) return { idx: null, changed: false };
  if (typeof idx === "string") {
    try {
      idx = JSON.parse(idx);
    } catch {
      return { idx: null, changed: false };
    }
  }
  if (typeof idx !== "object" || Array.isArray(idx)) return { idx: null, changed: false };

  let changed = false;
  const rels = Array.isArray(idx["相对路径列表"]) ? idx["相对路径列表"].map(String) : [];
  const nextRels = rels.filter((r) => {
    if (isRootJsonRel(r)) {
      changed = true;
      return false;
    }
    return true;
  });
  idx["相对路径列表"] = nextRels;
  idx["文件数"] = nextRels.length;

  const bc = idx["业务分类"];
  if (bc && typeof bc === "object" && !Array.isArray(bc)) {
    const md = bc["主数据"];
    if (Array.isArray(md) && md.length > 0) {
      bc["主数据"] = [];
      changed = true;
    }
  }

  return { idx, changed };
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
    console.log("表 reimbursement_bills 无「附件索引」列，跳过（新库已删列，无需清洗）。");
    await conn.end();
    return;
  }

  const [rows] = await conn.query("SELECT `报账单号`, `附件索引` FROM `reimbursement_bills` WHERE `附件索引` IS NOT NULL");
  let n = 0;
  for (const row of rows) {
    const out = cleanIndex(row["附件索引"]);
    if (!out.idx || !out.changed) continue;
    if (dry) {
      console.log("[DRY] 将更新:", row["报账单号"]);
      n += 1;
      continue;
    }
    await conn.execute("UPDATE `reimbursement_bills` SET `附件索引` = CAST(? AS JSON) WHERE `报账单号` = ?", [
      JSON.stringify(out.idx),
      row["报账单号"],
    ]);
    n += 1;
    console.log("已更新:", row["报账单号"]);
  }

  await conn.end();
  console.log(dry ? `DRY_RUN 结束，将更新 ${n} 行` : `完成。共更新 ${n} 行。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
