"use client";

import Link from "next/link";
import type { DatasourceSavedPayload } from "@/components/chat/types";
import { Database } from "lucide-react";

type Props = {
  payload: DatasourceSavedPayload;
};

export function DatasourceSavedCard({ payload }: Props) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-900 shadow-sm">
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">数据源已写入数据中心</p>
          <p className="truncate text-emerald-800/90">
            <span className="font-medium">{payload.name}</span>
            <span className="mx-1 text-emerald-600">·</span>
            <span className="text-emerald-700">{payload.summary}</span>
          </p>
          <p className="text-xs text-emerald-700/80">
            请在数据源管理中继续做连通性检测、更新字段、获取数据与字段勾选保存。
          </p>
          <Link
            href="/data-center"
            className="inline-flex text-sm font-medium text-emerald-800 underline decoration-emerald-400 underline-offset-2 hover:text-emerald-950"
          >
            打开数据中心
          </Link>
        </div>
      </div>
    </div>
  );
}
