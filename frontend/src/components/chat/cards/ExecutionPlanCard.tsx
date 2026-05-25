"use client";

import { ExecutionPlanPayload } from "@/components/chat/types";

type Props = {
  payload: ExecutionPlanPayload;
};

/**
 * ExecutionPlanCard 组件/函数。
 */
export function ExecutionPlanCard({ payload }: Props) {
  return (
    <section className="mb-4 w-full max-w-2xl rounded-xl border border-gray-100 bg-white p-4 shadow-soft dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h4 className="font-semibold text-gray-800">执行计划卡片</h4>
      <ol className="mt-2 space-y-1 pl-5 text-sm text-gray-700">
        {payload.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          确认执行
        </button>
        <button
          type="button"
          className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          修改计划
        </button>
      </div>
    </section>
  );
}

