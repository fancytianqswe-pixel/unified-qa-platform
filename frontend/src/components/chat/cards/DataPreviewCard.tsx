"use client";

import Image from "next/image";
import { useState } from "react";
import { DataPreviewPayload } from "@/components/chat/types";

type Props = {
  payload: DataPreviewPayload;
};

/**
 * DataPreviewCard 组件/函数。
 */
export function DataPreviewCard({ payload }: Props) {
  const [mappings, setMappings] = useState(payload.mappings);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function onDrop(toIndex: number) {
    if (dragIndex === null || dragIndex === toIndex) return;
    const next = [...mappings];
    const [item] = next.splice(dragIndex, 1);
    next.splice(toIndex, 0, item);
    setMappings(next);
    setDragIndex(null);
  }

  return (
    <section className="mb-4 w-full max-w-2xl rounded-xl border border-gray-100 bg-white p-4 shadow-soft dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h4 className="font-semibold text-gray-800">数据预览卡片</h4>
      <p className="mt-1 text-sm text-gray-500">展示前5条样例、字段映射与媒体缩略图，可拖拽调整映射顺序。</p>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {payload.samples.slice(0, 5).map((row, idx) => (
          <div key={idx} className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
            {Object.entries(row).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-gray-500">{k}</span>
                <span className="truncate">{String(v)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2">
        {mappings.map((m, idx) => (
          <div
            key={`${m.source}-${m.target}-${idx}`}
            draggable
            onDragStart={() => setDragIndex(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(idx)}
            className="flex cursor-grab items-center justify-between gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-700"
          >
            <span>{m.source}</span>
            <span className="text-indigo-500">→</span>
            <span>{m.target}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        {payload.media.map((u) => (
          <Image key={u} src={u} alt="media-thumb" width={120} height={72} className="rounded-lg object-cover" />
        ))}
      </div>
    </section>
  );
}

