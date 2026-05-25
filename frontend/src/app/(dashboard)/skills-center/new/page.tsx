"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Skill } from "@/components/skills/types";
import { SKILL_CATALOG_SECTION_DEFAULT } from "@/components/skills/data";
import { upsertLocalSkill } from "@/lib/skill-local-storage";
import { useSessionAccess } from "@/components/layout/SessionAccessContext";
import { canUsePageButton } from "@/lib/session-access";

const PAGE_SKILLS_LIST = "menu-skills-center-list";

/**
 * 新建技能：调用注册接口并写入本地列表，便于大厅「我的技能」立即可见
 */
export default function NewSkillPage() {
  const router = useRouter();
  const access = useSessionAccess();
  const canCreate = !access || canUsePageButton(access, PAGE_SKILLS_LIST, "新建技能");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scene, setScene] = useState("general");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setError(null);
    const n = name.trim();
    const d = description.trim();
    if (!n || !d) {
      setError("请填写技能名称与描述");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/skills/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, description: d, scene: scene.trim() || "general" }),
      });
      const data = (await res.json()) as { ok?: boolean; skillId?: string; version?: string; message?: string };
      if (!data.ok || !data.skillId) {
        setError(data.message ?? "注册失败");
        setLoading(false);
        return;
      }
      const skill: Skill = {
        id: data.skillId,
        icon: "✨",
        name: n,
        author: "我",
        version: data.version ?? "1.0.0",
        source: "user",
        status: "draft",
        rating: 0,
        usageCount: 0,
        description: d,
        samplePrompt: `请使用技能「${n}」完成以下任务：`,
        params: [{ key: "task", desc: "任务描述", required: true }],
        config: { url: "https://example.com/placeholder", sql: "SELECT 1", threshold: 0.9 },
        category: "通用工具",
        catalogSection: SKILL_CATALOG_SECTION_DEFAULT,
        badgeLabel: "个人",
        listScope: "mine",
        mineKind: "personal",
      };
      upsertLocalSkill(skill);
      router.push(`/skills-center/${encodeURIComponent(data.skillId)}`);
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <Link href="/skills-center" className="text-sm text-slate-600 hover:text-slate-900">
        ← 返回技能中心
      </Link>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">新建技能</h1>
      <p className="mt-1 text-sm text-slate-500">提交后将注册占位技能并出现在「我的技能」中，可在详情页继续试用与克隆编辑。</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：门店日报汇总"
            className="!mt-1"
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          描述
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="说明适用场景、输入输出与约束"
            className="!mt-1"
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          场景标识
          <input
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            placeholder="如 general / ops / fin"
            className="!mt-1"
          />
        </label>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/skills-center"
            className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={loading || !canCreate}
            className="!rounded-full !bg-slate-900 px-4 py-2 text-sm font-semibold !text-white hover:!bg-slate-800 disabled:opacity-60"
          >
            {loading ? "提交中…" : "创建"}
          </button>
        </div>
      </form>
    </main>
  );
}
