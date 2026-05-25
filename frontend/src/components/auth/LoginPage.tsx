"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { setDataScopeUserId } from "@/lib/client-data-scope";
import { fetchTimeoutSignal } from "@/lib/fetch-timeout-signal";
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from "@/lib/ui-preferences";

function LoginLanguageSelect() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
      <label
        htmlFor="login-locale"
        className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        {t("general.language")}
      </label>
      <select
        id="login-locale"
        className="!h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
  );
}

/**
 * 根路径登录：与「系统管理 → 用户与权限」中的超级管理员账号一致（默认 admin / admin）。
 */
export function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sessionProbeError, setSessionProbeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const tid = window.setTimeout(() => ac.abort(), 12_000);
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          signal: ac.signal,
        });
        const text = await res.text();
        if (cancelled) return;
        if (res.ok) {
          try {
            const json = JSON.parse(text) as { ok?: boolean };
            if (json.ok) {
              router.replace("/new-task");
            } else {
              setSessionProbeError(`GET /api/auth/me HTTP ${res.status}\n响应 JSON ok 为 false：\n${text.slice(0, 4000)}`);
            }
          } catch {
            setSessionProbeError(`GET /api/auth/me HTTP ${res.status} 但正文非 JSON：\n${text.slice(0, 4000)}`);
          }
        } else if (res.status === 401 || res.status === 403) {
          /** 无有效会话或未授权探测：与「未登录」一致，属正常态，勿当作故障黄条 */
        } else {
          setSessionProbeError(`GET /api/auth/me 失败 HTTP ${res.status} ${res.statusText}\n${text.slice(0, 4000)}`);
        }
      } catch (e) {
        if (!cancelled) {
          const name = e instanceof Error ? e.name : "Error";
          const msg = e instanceof Error ? e.message : String(e);
          setSessionProbeError(
            `${name}: ${msg}\n（常见：网络不可达、12s 探测超时 Abort、或 CORS/代理截断响应）`,
          );
        }
      } finally {
        window.clearTimeout(tid);
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
      ac.abort();
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: fetchTimeoutSignal(30_000),
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const raw = await res.text();
      let data: { ok?: boolean; message?: string; user?: { id?: string } };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        setError(`${t("login.fail")}\nHTTP ${res.status}\n${raw.slice(0, 2000)}`);
        return;
      }
      if (!res.ok || !data.ok) {
        const head = data.message ?? t("login.fail");
        const tail = raw.trim() ? `\n---\n${raw.slice(0, 2000)}` : "";
        setError(head + tail);
        return;
      }
      if (data.user?.id) {
        setDataScopeUserId(data.user.id);
        const [{ rehydrateChatStoreForDataScope }, { invalidateSkillsCachesForListAndDetail }] = await Promise.all([
          import("@/store/chatStore"),
          import("@/lib/skills-api-cache"),
        ]);
        await rehydrateChatStoreForDataScope();
        invalidateSkillsCachesForListAndDetail();
      }
      router.replace("/new-task");
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(`${t("login.networkError")}\n${msg}`);
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="jump-page bg-[#F7F8FA] px-4 dark:bg-slate-950">
        <section className="w-full max-w-[400px] rounded-[28px] border border-[#E0E0E0] bg-white p-8 text-center shadow-sm dark:border-slate-600 dark:bg-slate-900">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("login.checking")}</p>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            {t("login.checkingHint")}
          </p>
          {sessionProbeError ? (
            <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-rose-200 bg-rose-50 p-3 text-left text-[11px] leading-relaxed whitespace-pre-wrap break-words text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
              {sessionProbeError}
            </pre>
          ) : null}
          <LoginLanguageSelect />
        </section>
      </main>
    );
  }

  return (
    <main className="jump-page px-4 dark:bg-slate-950">
      <div className="w-full max-w-[400px] rounded-[28px] border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-slate-600 dark:bg-slate-900">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative size-14 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {/* 使用原生 img，避免 next/image 优化管道在部分环境下阻塞或失败导致首屏异常 */}
            <img
              src="/brand/logo.png"
              alt={t("login.title")}
              width={56}
              height={56}
              className="size-14 object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("login.title")}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("login.subtitle")}</p>
          </div>
        </div>
        {sessionProbeError ? (
          <pre className="mb-4 max-h-40 overflow-auto rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-[11px] leading-relaxed whitespace-pre-wrap break-words text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            {t("login.sessionProbeHint")}

            {sessionProbeError}
          </pre>
        ) : null}
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("login.account")}</label>
            <input
              className="!h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("login.password")}</label>
            <input
              className="!h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="!mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
        <LoginLanguageSelect />
      </div>
    </main>
  );
}
