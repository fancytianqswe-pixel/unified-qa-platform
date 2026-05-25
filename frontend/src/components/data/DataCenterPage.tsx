"use client";

import { useSearchParams } from "next/navigation";
import { DataSourceManager } from "@/components/data/DataSourceManager";

/**
 * DataCenterPage 组件/函数。
 */
export function DataCenterPage() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const diagnosis = searchParams.get("diagnosis");

  return (
    <main className="skill-shell">
      {from === "chat" ? (
        <section className="task-card">
          <h3>来自对话的修复引导</h3>
          <p className="text-sm text-gray-600">
            你是从对话异常跳转而来，请优先检查数据源连接参数并执行连通性测试。
          </p>
          {diagnosis ? (
            <p className="mt-1 text-xs text-rose-600">诊断信息：{decodeURIComponent(diagnosis)}</p>
          ) : null}
        </section>
      ) : null}
      <DataSourceManager />
    </main>
  );
}

