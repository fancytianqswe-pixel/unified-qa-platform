import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function keysFromDeepFile(rel) {
  const s = fs.readFileSync(path.join(root, rel), "utf8");
  const re = /"((?:admin|model|chat|skill|skills|mcp|data|loading|error)(?:\.[^"]+)?)":/g;
  const keys = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(s)) !== null) {
    const k = m[1];
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

const ke = keysFromDeepFile("src/i18n/messages/deep-en.ts");
const kc = keysFromDeepFile("src/i18n/messages/deep-zh-cn.ts");
const se = new Set(ke);
const sc = new Set(kc);
const miss = ke.filter((k) => !sc.has(k));
const extra = kc.filter((k) => !se.has(k));
console.log("en keys", ke.length, "cn keys", kc.length);
console.log("missing in cn", miss.length, miss);
console.log("extra in cn", extra.length, extra);
