/**
 * 校验各 `deep-*` 与 `deep-en` 键集一致。运行：npx tsx scripts/verify-all-deep-keys.ts
 */
import { deepMessagesEn } from "../src/i18n/messages/deep-en";
import { deepMessagesZhCN } from "../src/i18n/messages/deep-zh-cn";
import { deepMessagesZhTW } from "../src/i18n/messages/deep-zh-tw";
import { deepMessagesJa } from "../src/i18n/messages/deep-ja";
import { deepMessagesKo } from "../src/i18n/messages/deep-ko";
import { deepMessagesFr } from "../src/i18n/messages/deep-fr";
import { deepMessagesDe } from "../src/i18n/messages/deep-de";

function diff(
  name: string,
  a: Record<string, string>,
  b: Record<string, string>,
): void {
  const ka = Object.keys(a);
  const kb = new Set(Object.keys(b));
  const miss = ka.filter((k) => !kb.has(k));
  const extra = Object.keys(b).filter((k) => !ka.includes(k));
  if (miss.length || extra.length) {
    console.error(name, "missing", miss.length, miss.slice(0, 5), "extra", extra.length, extra.slice(0, 5));
    process.exitCode = 1;
  } else {
    console.log(name, "OK", ka.length, "keys");
  }
}

const en = deepMessagesEn;
diff("zh-CN", en, deepMessagesZhCN);
diff("zh-TW", en, deepMessagesZhTW);
diff("ja", en, deepMessagesJa);
diff("ko", en, deepMessagesKo);
diff("fr", en, deepMessagesFr);
diff("de", en, deepMessagesDe);

if (process.exitCode === 1) {
  process.exit(1);
}
