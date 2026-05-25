/**
 * 深层文案契约：完整语言包须与 `deep-en.ts` 拥有相同的键集合。
 *
 * 新增语言步骤：
 * 1. 复制 `src/i18n/messages/deep-en.ts` 为 `deep-<locale>.ts`（如 `deep-fr.ts`）。
 * 2. 将 `export const deepMessagesEn` 改为 `deepMessages<Locale>`，逐条翻译 value，**键名不变**。
 * 3. 在 `src/i18n/messages/<locale>.ts` 维护导航/登录等「表层」键（若尚无该文件则新增）。
 * 4. 在 `src/i18n/registry.ts` 的 `bundles` 中注册：`{ ...messagesX, ...deepMessagesX }`。
 * 5. 在 `src/lib/ui-preferences.ts` 的 `AppLocale` / `APP_LOCALES` / `intlLocaleForApp` 中已有 locale 则跳过。
 *
 * 未完成完整 `deep-*` 前，可暂时合并 `deepMessagesEn` 作为占位。
 */
import { deepMessagesEn } from "@/i18n/messages/deep-en";

export type DeepMessagesShape = typeof deepMessagesEn;
