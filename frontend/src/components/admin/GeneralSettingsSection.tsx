"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from "@/lib/ui-preferences";
import { getUserAvatarGlyph } from "@/lib/user-avatar-glyph";
import { LogOut, Moon, Sun } from "lucide-react";

type Props = {
  displayName: string;
  role: string;
  onLogout: () => void | Promise<void>;
};

/**
 * 系统管理 → 常规：语言、浅色/深色主题、侧栏已移除的悬停退出入口改为此处显式退出。
 */
export function GeneralSettingsSection({ displayName, role, onLogout }: Props) {
  const { t, locale, setLocale, theme, setTheme } = useI18n();
  const glyph = getUserAvatarGlyph(displayName);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-base font-semibold text-blue-800">
          {glyph}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
            {displayName || "…"}
          </p>
          {role ? (
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{role}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <LogOut className="size-4" />
          {t("general.logout")}
        </button>
      </div>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("general.sectionGeneral")}</h4>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("general.language")}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("general.languageDesc")}</p>
            </div>
            <select
              className="mt-2 h-10 w-full shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 sm:mt-0 sm:w-52 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={locale}
              onChange={(e) => setLocale(e.target.value as AppLocale)}
            >
              {APP_LOCALES.map((id) => (
                <option key={id} value={id}>
                  {LOCALE_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("general.sectionAppearance")}</h4>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("general.theme")}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("general.themeDesc")}</p>
            </div>
            <div
              role="group"
              aria-label={t("general.theme")}
              className="inline-flex shrink-0 rounded-full bg-[#E8E8E8] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] dark:bg-slate-800/95 dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            >
              {(
                [
                  { id: "light" as const, icon: Sun },
                  { id: "dark" as const, icon: Moon },
                ] as const
              ).map(({ id, icon: Icon }) => {
                const selected = theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTheme(id)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                      selected
                        ? "bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.12)] dark:bg-slate-700 dark:text-slate-50 dark:shadow-[0_1px_6px_rgba(0,0,0,0.35)]"
                        : "bg-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    {id === "light" ? t("general.themeLight") : t("general.themeDark")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
