/**
 * 由 deep-zh-cn 经 OpenCC（cn→tw）生成 deep-zh-tw.ts；键序与 deep-en 一致。
 * 运行：npx tsx scripts/gen-deep-zh-tw.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenCC from "opencc-js";
import { deepMessagesEn } from "../src/i18n/messages/deep-en";
import { deepMessagesZhCN } from "../src/i18n/messages/deep-zh-cn";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../src/i18n/messages/deep-zh-tw.ts");

const toTw = OpenCC.Converter({ from: "cn", to: "tw" });

function escapeTsString(s: string): string {
  return JSON.stringify(s);
}

const keys = Object.keys(deepMessagesEn) as (keyof typeof deepMessagesZhCN)[];
const missing = keys.filter((k) => deepMessagesZhCN[k] === undefined);
if (missing.length) {
  console.error("Missing zh-CN keys:", missing);
  process.exit(1);
}

const lines: string[] = [
  "/** 深層介面文案（繁體中文，由 deep-zh-cn 經 OpenCC 轉換並人工對齊用語） */",
  "export const deepMessagesZhTW: Record<string, string> = {",
];

for (const k of keys) {
  const raw = deepMessagesZhCN[k];
  let v = toTw(raw);
  // 與表層 zh-TW 用語一致
  v = v
    .replace(/默認/g, "預設")
    .replace(/數據庫/g, "資料庫")
    .replace(/數據/g, "資料")
    .replace(/賬號/g, "帳號")
    .replace(/登錄/g, "登入")
    .replace(/用戶名/g, "使用者名稱")
    .replace(/用戶/g, "使用者")
    .replace(/字段/g, "欄位")
    .replace(/支持/g, "支援")
    .replace(/平臺/g, "平台")
    .replace(/內置/g, "內建")
    .replace(/接口地址/g, "介面網址")
    .replace(/接口密鑰/g, "API 金鑰")
    .replace(/接口/g, "介面");
  lines.push(`  ${escapeTsString(k)}: ${escapeTsString(v)},`);
}

lines.push("};", "");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log("Wrote", outPath, "keys", keys.length);
