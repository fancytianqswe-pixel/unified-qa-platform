"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: number;
  source: string;
  message: string;
  stack?: string;
  time: string;
};

function stringifyReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack };
  }
  if (typeof reason === "string") {
    return { message: reason };
  }
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: String(reason) };
  }
}

/**
 * 监听 window.error 与 unhandledrejection，在页面底部固定区域打印最近若干条，
 * 便于排查「控制台有红字但 UI 无反馈」类问题。
 */
export function ClientRuntimeDiagnostics() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let seq = 0;
    const push = (source: string, err: unknown) => {
      const e = err instanceof Error ? err : null;
      const fromUnknown = e ? { message: e.message, stack: e.stack } : stringifyReason(err);
      const id = ++seq;
      const time = new Date().toLocaleString();
      setEntries((prev) => [...prev.slice(-12), { id, source, ...fromUnknown, time }]);
    };

    const onError = (ev: ErrorEvent) => {
      push("window.error", ev.error ?? ev.message);
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      push("unhandledrejection", ev.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!entries.length) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto fixed bottom-0 left-0 right-0 z-[10000] border-t-2 border-amber-600 bg-amber-950/97 text-amber-50 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      role="region"
      aria-label="客户端运行时错误"
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-800 px-3 py-2">
        <span className="text-xs font-semibold text-amber-100">客户端运行时错误（最近 {entries.length} 条）</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-amber-800 px-2 py-1 text-[11px] hover:bg-amber-700"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? "展开" : "收起"}
          </button>
          <button
            type="button"
            className="rounded bg-amber-800 px-2 py-1 text-[11px] hover:bg-amber-700"
            onClick={() => setEntries([])}
          >
            清空
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="max-h-[38vh] overflow-auto px-3 py-2 text-left">
          {entries.map((x) => (
            <pre
              key={x.id}
              className="mb-2 whitespace-pre-wrap break-all border-b border-amber-900/80 pb-2 font-mono text-[11px] leading-relaxed last:mb-0 last:border-0"
            >
              {`[${x.time}] ${x.source}\n${x.message}${x.stack ? `\n---\n${x.stack}` : ""}`}
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}
