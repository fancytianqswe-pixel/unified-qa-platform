"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  APP_LOCALES,
  type AppLocale,
  type UiTheme,
  UI_LOCALE_STORAGE_KEY,
  UI_THEME_STORAGE_KEY,
  readStoredLocale,
  readStoredTheme,
} from "@/lib/ui-preferences";
import { formatMessage, getMessageBundle } from "@/i18n/registry";

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (l: AppLocale) => void;
  theme: UiTheme;
  setTheme: (t: UiTheme) => void;
  t: (key: string, vars?: Record<string, string>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function applyThemeToDom(theme: UiTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("zh-CN");
  const [theme, setThemeState] = useState<UiTheme>("light");

  useEffect(() => {
    const l = readStoredLocale();
    const th = readStoredTheme();
    if (l) setLocaleState(l);
    if (th) {
      setThemeState(th);
      applyThemeToDom(th);
    } else {
      applyThemeToDom("light");
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = l ?? "zh-CN";
    }
  }, []);

  const setLocale = useCallback((l: AppLocale) => {
    if (!APP_LOCALES.includes(l)) return;
    setLocaleState(l);
    try {
      localStorage.setItem(UI_LOCALE_STORAGE_KEY, l);
    } catch {
      /* noop */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = l;
    }
  }, []);

  const setTheme = useCallback((t: UiTheme) => {
    setThemeState(t);
    try {
      localStorage.setItem(UI_THEME_STORAGE_KEY, t);
    } catch {
      /* noop */
    }
    applyThemeToDom(t);
  }, []);

  const bundle = useMemo(() => getMessageBundle(locale), [locale]);
  const bundleEn = useMemo(() => getMessageBundle("en"), []);
  const bundleZh = useMemo(() => getMessageBundle("zh-CN"), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => {
      try {
        const raw = bundle[key] ?? bundleEn[key] ?? bundleZh[key] ?? key;
        return vars ? formatMessage(raw, vars) : raw;
      } catch {
        return key;
      }
    },
    [bundle, bundleEn, bundleZh],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, theme, setTheme, t }),
    [locale, setLocale, theme, setTheme, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
