"use client";

/**
 * 根级全局错误 UI：替换整个 root layout，**不得**依赖 `I18nProvider` 等外层 Context。
 * 用于根 layout 或子树未捕获异常时，避免用户只看到空白或代理返回的纯文本 500。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 p-6 text-slate-900">
        <main className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">页面加载失败</h1>
          <p className="mt-2 text-sm text-slate-600">
            应用遇到未预期错误。请查看运行 <code className="rounded bg-slate-100 px-1">npm run dev</code>{" "}
            的终端输出中的报错栈；可尝试{" "}
            <code className="rounded bg-slate-100 px-1">npm run dev:clean</code> 清除缓存后重试。
          </p>
          {error?.digest ? (
            <p className="mt-2 font-mono text-xs text-slate-500">digest: {error.digest}</p>
          ) : null}
          {error?.message ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-900 whitespace-pre-wrap">
              {error.message}
            </pre>
          ) : null}
          {error?.stack ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-100 p-3 text-[11px] text-slate-800 whitespace-pre-wrap">
              {error.stack}
            </pre>
          ) : null}
          <button
            type="button"
            className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => reset()}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
