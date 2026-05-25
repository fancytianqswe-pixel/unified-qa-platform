/**
 * 删除 qa_test_baodan.reimbursement_bills 已弃用列：附件索引、本地附件目录
 * 用法（仓库根）：node scripts/drop_baodan_legacy_attach_columns.mjs
 * 依赖 frontend/node_modules/mysql2（与 import_qa_test_baodan.mjs 一致）
 * 可用 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD 覆盖连接
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../frontend/package.json"));
const mysql = require("mysql2/promise");

const host = process.env.MYSQL_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.MYSQL_PORT?.trim() || "3307");
const user = process.env.MYSQL_USER?.trim() || "root";
const password = process.env.MYSQL_PASSWORD?.trim() || "Root#2026!AiCursor";

const cols = ["附件索引", "本地附件目录"];

const conn = await mysql.createConnection({ host, port, user, password });
await conn.query("USE qa_test_baodan");
for (const col of cols) {
  try {
    await conn.query(`ALTER TABLE reimbursement_bills DROP COLUMN \`${col}\``);
    console.log("dropped:", col);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/1091|Unknown column|doesn't exist|check that column/i.test(msg)) {
      console.log("skip (missing):", col);
    } else {
      throw e;
    }
  }
}
await conn.end();
console.log("done");
