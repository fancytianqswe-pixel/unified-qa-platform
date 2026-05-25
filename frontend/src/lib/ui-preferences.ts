export const UI_LOCALE_STORAGE_KEY = "xingyan_ui_locale";
export const UI_THEME_STORAGE_KEY = "xingyan_ui_theme";

export type AppLocale = "zh-CN" | "zh-TW" | "en" | "ja" | "ko" | "fr" | "de";
export type UiTheme = "light" | "dark";

export const APP_LOCALES: AppLocale[] = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de"];

export const LOCALE_LABELS: Record<AppLocale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
};

export function readStoredLocale(): AppLocale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (raw && APP_LOCALES.includes(raw as AppLocale)) return raw as AppLocale;
  } catch {
    /* noop */
  }
  return null;
}

export function readStoredTheme(): UiTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(UI_THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    /* noop */
  }
  return null;
}

export function intlLocaleForApp(locale: AppLocale): string {
  const map: Record<AppLocale, string> = {
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    en: "en-US",
    ja: "ja-JP",
    ko: "ko-KR",
    fr: "fr-FR",
    de: "de-DE",
  };
  return map[locale];
}
