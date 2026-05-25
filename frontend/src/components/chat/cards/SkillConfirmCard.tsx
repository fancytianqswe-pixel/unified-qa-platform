"use client";

import { useState } from "react";
import { SkillConfirmPayload } from "@/components/chat/types";
import { useChatStore } from "@/store/chatStore";

type Props = {
  payload: SkillConfirmPayload;
};

/**
 * SkillConfirmCard 组件/函数。
 */
export function SkillConfirmCard({ payload }: Props) {
  const registerSkill = useChatStore((s) => s.registerSkill);
  const [state, setState] = useState<"idle" | "saving" | "done" | "fail">("idle");

  async function onConfirm() {
    setState("saving");
    const result = await registerSkill(payload);
    setState(result.ok ? "done" : "fail");
  }

  return (
    <section className="mb-4 w-full max-w-2xl rounded-xl border border-gray-100 bg-white p-4 shadow-soft dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h4 className="font-semibold text-gray-800">技能生成确认卡</h4>
      <p className="mt-2 text-sm text-gray-700">
        <strong>技能名称：</strong>
        {payload.name}
      </p>
      <p className="mt-1 text-sm text-gray-700">
        <strong>技能描述：</strong>
        {payload.description}
      </p>
      <p className="mt-1 text-sm text-gray-700">
        <strong>适用场景：</strong>
        {payload.scene}
      </p>

      <button
        type="button"
        onClick={onConfirm}
        disabled={state === "saving" || state === "done"}
        className="mt-3 rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
      >
        {state === "saving" ? "注册中..." : state === "done" ? "已注册" : "确认并注册到商城"}
      </button>
      {state === "done" ? (
        <button
          type="button"
          className="ml-2 mt-3 rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          onClick={() => {
            window.location.href = "/skills-center";
          }}
        >
          去技能中心查看
        </button>
      ) : null}
      {state === "fail" ? <p className="danger">注册失败，请稍后重试</p> : null}
    </section>
  );
}

