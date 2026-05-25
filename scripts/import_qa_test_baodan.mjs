/**
 * 将 test/报账单 下指定 JSON 导入 qa_test_baodan.reimbursement_bills（列与 JSON 叶子一一对应）。
 * 若业务已只维护库表、不再保留各单号根目录下的 `<报账单号>.json`，可改用 `patch_baodan_minio_columns.mjs` 等脚本，勿强依赖本导入。
 *
 * 用法（在仓库根）：
 *   node scripts/import_qa_test_baodan.mjs
 *
 * 启动时会读取 `docs/qa_test_baodan_schema.sql`（UTF-8）并执行建库建表，避免 PowerShell 管道导致中文标识符乱码。
 * 跳过建表：`SKIP_SCHEMA=1 node scripts/import_qa_test_baodan.mjs`
 *
 * 连接：MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD（默认同 docs/mysql_test_data.sql）
 *
 * **附件**：库表仅存 **`附件存储类型` / `附件存储桶` / `附件对象前缀`**（对象存储宣告）。设置 **`MINIO_BUCKET`** 时写入 minio、桶、`{MINIO_OBJECT_ROOT}/<报账单号>/`；清单以 BFF ListObjects（桶+前缀）为准，**不再**写入 `本地附件目录`、`附件索引`。
 */
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const mysql = require("mysql2/promise");

/** 与表字段顺序一致（对应 基本信息.*） */
const BASIC_KEYS = [
  "标题",
  "经济事项",
  "报账单号",
  "报账期间",
  "费用发生日",
  "报账人电话",
  "收支方式",
  "是否员工代垫",
  "合同编号",
  "合同名称",
  "合同租赁属性",
  "票据类型",
  "附单据张数",
  "纳税属性",
  "是否涉及进项税转出",
  "是否涉及影像扫描",
  "是否ICT涉密项目",
  "业务场景",
  "是否被共享",
  "预计付款日期",
  "报账说明",
];

const PAY_COL = "合同履约信息_toatlpayment";
const STORE_TYPE_COL = "附件存储类型";
const STORE_BUCKET_COL = "附件存储桶";
const STORE_PREFIX_COL = "附件对象前缀";

/** 与 BFF / sync_baodan_to_minio.mjs 的 MINIO_OBJECT_ROOT 默认一致 */
const minioBucketForMeta = (process.env.MINIO_BUCKET ?? "").trim();
const minioObjectRootForMeta = (process.env.MINIO_OBJECT_ROOT?.trim() || "报账单").replace(/^\/+|\/+$/g, "") || "报账单";

const SCHEMA_PATH = path.join(REPO_ROOT, "docs", "qa_test_baodan_schema.sql");

const REL_FILES = [
  "test/报账单/TYA01102040000312510100610/TYA01102040000312510100610.json",
  "test/报账单/TYA01102040400052508100004/TYA01102040400052508100004.json",
  "test/报账单/TYA01102040500052510100065/TYA01102040500052510100065.json",
  "test/报账单/TYA01102070000492510101058/TYA01102070000492510101058.json",
  "test/报账单/TYA01102070600942510100008/TYA01102070600942510100008.json",
];

const host = process.env.MYSQL_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.MYSQL_PORT?.trim() || "3307");
const user = process.env.MYSQL_USER?.trim() || "root";
const password = process.env.MYSQL_PASSWORD ?? "Root#2026!AiCursor";

function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parsePayment(v) {
  const s = str(v);
  if (s === null) return null;
  const n = Number.parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function qIdent(name) {
  return "`" + String(name).replace(/`/g, "") + "`";
}

async function main() {
  const skipSchema = /^1|true|yes$/i.test(String(process.env.SKIP_SCHEMA ?? "").trim());

  if (!skipSchema) {
    const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
    const setup = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true,
    });
    await setup.query(schemaSql);
    await setup.end();
  }

  const extraCols = [PAY_COL, STORE_TYPE_COL, STORE_BUCKET_COL, STORE_PREFIX_COL];
  const allCols = [...BASIC_KEYS.map(qIdent), ...extraCols.map(qIdent)].join(", ");
  const placeholders = [...BASIC_KEYS, ...extraCols].map(() => "?").join(", ");
  const updates = [...BASIC_KEYS, ...extraCols]
    .map((k) => {
      const qi = qIdent(k);
      return `${qi}=VALUES(${qi})`;
    })
    .join(", ");

  const sql = `INSERT INTO reimbursement_bills (${allCols}) VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE ${updates}`;

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: "qa_test_baodan",
    multipleStatements: false,
  });

  for (const rel of REL_FILES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.error("缺失文件:", abs);
      process.exitCode = 1;
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      console.error("JSON 解析失败:", abs, e);
      process.exitCode = 1;
      continue;
    }
    const b = doc?.基本信息;
    if (!b || typeof b !== "object") {
      console.error("缺少 基本信息:", abs);
      process.exitCode = 1;
      continue;
    }
    const billNo = str(b.报账单号);
    if (!billNo) {
      console.error("缺少 报账单号:", abs);
      process.exitCode = 1;
      continue;
    }

    const vals = BASIC_KEYS.map((k) => str(b[k]));
    vals.push(parsePayment(doc?.合同履约信息?.toatlpayment));
    if (minioBucketForMeta) {
      vals.push("minio", minioBucketForMeta, `${minioObjectRootForMeta}/${billNo}/`);
    } else {
      vals.push(null, null, null);
    }

    await conn.execute(sql, vals);
    console.log("已导入:", billNo);
  }

  await conn.end();
  console.log("完成。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
