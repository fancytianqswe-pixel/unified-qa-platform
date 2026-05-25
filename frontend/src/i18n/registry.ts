import type { AppLocale } from "@/lib/ui-preferences";
import { messagesZhCN } from "@/i18n/messages/zh-CN";
import { messagesZhTW } from "@/i18n/messages/zh-TW";
import { messagesEn } from "@/i18n/messages/en";
import { messagesJa } from "@/i18n/messages/ja";
import { messagesKo } from "@/i18n/messages/ko";
import { messagesFr } from "@/i18n/messages/fr";
import { messagesDe } from "@/i18n/messages/de";
import { deepMessagesZhCN } from "@/i18n/messages/deep-zh-cn";
import { deepMessagesEn } from "@/i18n/messages/deep-en";
import { deepMessagesJa } from "@/i18n/messages/deep-ja";
import { deepMessagesKo } from "@/i18n/messages/deep-ko";
import { deepMessagesZhTW } from "@/i18n/messages/deep-zh-tw";
import { deepMessagesFr } from "@/i18n/messages/deep-fr";
import { deepMessagesDe } from "@/i18n/messages/deep-de";

/**
 * 语言包 = 表层 `messages/<locale>.ts` + 深层 `messages/deep-<locale>.ts`（键集须与 `deep-en` 对齐）。
 * 规范说明见 `src/i18n/deep-locale-contract.ts`。
 */
const bundles: Record<AppLocale, Record<string, string>> = {
  "zh-CN": { ...messagesZhCN, ...deepMessagesZhCN },
  "zh-TW": { ...messagesZhTW, ...deepMessagesZhTW },
  en: { ...messagesEn, ...deepMessagesEn },
  ja: { ...messagesJa, ...deepMessagesJa },
  ko: { ...messagesKo, ...deepMessagesKo },
  fr: { ...messagesFr, ...deepMessagesFr },
  de: { ...messagesDe, ...deepMessagesDe },
};

export function getMessageBundle(locale: AppLocale): Record<string, string> {
  return bundles[locale] ?? bundles["zh-CN"];
}

/**
 * `{path}` 等占位符替换。
 * 使用 split/join 避免 `String#replaceAll` 对替换串中 `$`、`$&` 等的特殊语义导致异常或乱码。
 */
export function formatMessage(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const token = `{${k}}`;
    if (!out.includes(token)) continue;
    const safe = v == null ? "" : String(v);
    out = out.split(token).join(safe);
  }
  return out;
}
