"use client";

import { ErrorDiagnosisPayload } from "@/components/chat/types";
import { useChatStore } from "@/store/chatStore";

type Props = {
  payload: ErrorDiagnosisPayload;
};

/**
 * ErrorDiagnosisCard 组件/函数。
 */
export function ErrorDiagnosisCard({ payload }: Props) {
  const diagnosticText = `错误原因：${payload.reason}\n建议：${payload.suggestions.join("；")}`;
  const retryLatestTurn = useChatStore((s) => s.retryLatestTurn);

  return (
    <section className="mb-4 w-full max-w-2xl rounded-xl border border-gray-100 bg-white p-4 shadow-soft dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h4 className="font-semibold text-gray-800">错误诊断卡片</h4>
      <p className="mt-2 text-sm text-gray-700">
        <strong>错误原因：</strong>
        {payload.reason}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {payload.suggestions.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          onClick={() => {
            void retryLatestTurn();
          }}
        >
          重试任务
        </button>
        <button
          type="button"
          className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          onClick={() => {
            const url = `/data-center?from=chat&diagnosis=${encodeURIComponent(payload.reason)}`;
            window.location.href = url;
          }}
        >
          去数据中心修复
        </button>
        <button
          type="button"
          className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(diagnosticText);
            } catch {
              // ignore
            }
          }}
        >
          复制诊断
        </button>
      </div>
    </section>
  );
}

