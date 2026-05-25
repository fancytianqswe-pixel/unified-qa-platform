"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code2, Download, Eye, Pencil } from "lucide-react";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { Skill } from "@/components/skills/types";
import { loadLocalSkills } from "@/lib/skill-local-storage";
import { getSkillMarkdown } from "@/lib/skill-doc";
import { isSkillSubscribed, setSkillSubscribed } from "@/lib/skill-subscriptions";
import { normalizeSkillBadgeLabel } from "@/lib/skill-badge-label";
import { findBuiltinMockFallbackForDetailId } from "@/lib/skills-detail-fallback";
import { normalizeSkillDetailRouteId } from "@/lib/skill-route-id";
import { getCachedSkillDetail, setCachedSkillDetail } from "@/lib/skills-api-cache";
import { useI18n } from "@/i18n/I18nProvider";
import { useSessionAccess } from "@/components/layout/SessionAccessContext";
import { canUsePageButton } from "@/lib/session-access";

const PAGE_SKILLS_DETAIL = "menu-skills-center-detail";
import {
  displaySkillDescriptionForUi,
  displaySkillNameForUi,
  displaySkillSamplePromptForUi,
  getBuiltinSlugFromSkillId,
} from "@/lib/skill-builtin-i18n";

function isBuiltinSkillDetail(s: Skill): boolean {
  return s.skillPolicy === "builtin" || Boolean(getBuiltinSlugFromSkillId(s.id));
}

type Props = {
  skillId: string;
};

type DocView = "preview" | "raw";

function DetailAvatar({ icon }: { icon: string }) {
  const t = icon.trim();
  const letterGlyph = /^[A-Za-z0-9]{1,2}$/.test(t);
  if (letterGlyph) {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-semibold text-white">
        {t.toUpperCase()}
      </span>
    );
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-2xl leading-none dark:bg-slate-800 dark:text-slate-100">
      {t}
    </span>
  );
}

/**
 * 技能详情：面包屑 + 头图区 + 元数据四栏 + 文件 Tab（SKILL.md 预览/源码）+ 克隆草稿编辑器
 */
export function SkillDetailView({ skillId }: Props) {
  const { t } = useI18n();
  const access = useSessionAccess();
  const canSub = !access || canUsePageButton(access, PAGE_SKILLS_DETAIL, "订阅管理");
  const canCloneCustomize = !access || canUsePageButton(access, PAGE_SKILLS_DETAIL, "克隆与定制");
  const canDl = !access || canUsePageButton(access, PAGE_SKILLS_DETAIL, "下载文档");
  const canPv = !access || canUsePageButton(access, PAGE_SKILLS_DETAIL, "文档预览");
  const canSrc = !access || canUsePageButton(access, PAGE_SKILLS_DETAIL, "文档源码");
  const [subscribed, setSubscribed] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  // 初始状态须与服务端一致，禁止用 `typeof window` 分支读缓存，否则首屏会 hydration mismatch
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [docView, setDocView] = useState<DocView>("preview");

  const markdown = useMemo(() => (skill ? getSkillMarkdown(skill) : ""), [skill]);

  useEffect(() => {
    if (!canCloneCustomize && draftMode) setDraftMode(false);
  }, [canCloneCustomize, draftMode]);

  useEffect(() => {
    let active = true;
    const idKey = normalizeSkillDetailRouteId(skillId);

    function resolveLocal(forId: string): Skill | null {
      return (
        findBuiltinMockFallbackForDetailId(forId) ??
        loadLocalSkills().find((s) => s.id === forId) ??
        null
      );
    }

    const cached = getCachedSkillDetail(idKey);
    if (cached) {
      setSkill(cached);
      if (!isBuiltinSkillDetail(cached)) setSubscribed(isSkillSubscribed(cached.id));
      setLoading(false);
    } else {
      setLoading(true);
    }

    (async () => {
      let next: Skill | null = null;
      try {
        const res = await fetch(`/api/skills/detail?id=${encodeURIComponent(idKey)}`);
        let data: { skill?: Skill | null } = {};
        try {
          data = (await res.json()) as { skill?: Skill | null };
        } catch {
          data = {};
        }
        if (!active) return;
        next = res.ok ? (data.skill ?? null) : null;
        if (!next) {
          next = resolveLocal(idKey) ?? resolveLocal(skillId);
        } else {
          setCachedSkillDetail(idKey, next);
        }
      } catch {
        if (!active) return;
        next = resolveLocal(idKey) ?? resolveLocal(skillId);
      }
      if (!active) return;
      setSkill(next);
      if (next && !isBuiltinSkillDetail(next)) setSubscribed(isSkillSubscribed(next.id));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [skillId]);

  const toggleSubscribe = useCallback(() => {
    if (!skill || !canSub) return;
    const next = !subscribed;
    setSubscribed(next);
    setSkillSubscribed(skill.id, next);
  }, [skill, subscribed, canSub]);

  const downloadMd = useCallback(() => {
    if (!canDl) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "SKILL.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [markdown, canDl]);

  if (loading) {
    return (
      <div className="flex min-h-[min(50vh,calc(100vh-10rem))] w-full items-center justify-center px-4 py-10">
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-lg rounded-3xl border border-slate-200/90 bg-white py-14 text-center shadow-sm ring-1 ring-slate-900/[0.04] dark:border-slate-600 dark:bg-slate-900 dark:shadow-none dark:ring-slate-700/80"
        >
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("skills.detailLoading")}</p>
        </div>
      </div>
    );
  }
  if (!skill) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="rounded-3xl border border-slate-200/90 bg-white px-6 py-12 dark:border-slate-600 dark:bg-slate-900">
          <p className="text-slate-700 dark:text-slate-200">{t("skills.detailNotFound")}</p>
          <Link
            href="/skills-center"
            className="mt-4 inline-block text-sm text-sky-700 hover:underline dark:text-sky-400"
          >
            {t("skills.detailBackLink")}
          </Link>
        </div>
      </div>
    );
  }

  const isBuiltinUi = isBuiltinSkillDetail(skill);

  const listScope = skill.listScope ?? (skill.source === "user" ? "mine" : "market");
  const sourceLabel = isBuiltinUi
    ? t("skill.badge.builtin")
    : listScope === "mine"
      ? (skill.mineKind ?? (skill.source === "user" ? "personal" : "platform")) === "platform"
        ? "平台内置"
        : "个人"
      : normalizeSkillBadgeLabel(skill.badgeLabel) ??
        skill.badgeLabel ??
        (skill.source === "user" ? "个人" : "市场");
  const rawCategory = skill.category?.trim();
  const categoryDisplay =
    isBuiltinUi && rawCategory
      ? (() => {
          const k = `skills.cat.${rawCategory}`;
          const v = t(k);
          return v === k ? rawCategory : v;
        })()
      : rawCategory || "—";
  const ratingDisplay = skill.rating > 0 ? String(skill.rating) : t("skills.detailNoRating");
  const updatedDisplay = skill.updatedAt?.trim() || new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-full bg-transparent pb-16">
      {/* 与 DashboardShell 顶栏 h-11 + sticky top-0 对齐，主区滚动时面包屑留在顶栏正下方 */}
      <div className="sticky top-11 z-10 -mx-6 border-b border-slate-200/80 bg-[#FCFCFA] px-6 py-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <nav className="text-sm text-slate-500 dark:text-slate-400">
            <Link
              href="/skills-center"
              className="hover:text-slate-800 dark:hover:text-slate-200"
            >
              {t("nav.skillsCenter")}
            </Link>
            <span className="mx-2 text-slate-300 dark:text-slate-600">/</span>
            <span className="text-slate-700 dark:text-slate-200">{skill.id}</span>
          </nav>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <section className="mt-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-none">
          <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
            <DetailAvatar icon={skill.icon} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
                      {displaySkillNameForUi(skill, t)}
                    </h1>
                    {!isBuiltinUi ? (
                      <button
                        type="button"
                        title="编辑与定制"
                        disabled={!canCloneCustomize}
                        onClick={() => canCloneCustomize && setDraftMode(true)}
                        className="inline-flex !rounded-lg !border !border-slate-200 !bg-white p-1.5 !text-slate-600 hover:!bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-300 dark:hover:!bg-slate-700"
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {displaySkillDescriptionForUi(skill, t)}
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {t("skills.detailSampleLabel")}
                    <span className="text-slate-700 dark:text-slate-200">「{displaySkillSamplePromptForUi(skill, t)}」</span>
                  </p>
                </div>

                {!isBuiltinUi ? (
                  <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      disabled={!canCloneCustomize}
                      onClick={() => canCloneCustomize && setDraftMode(true)}
                      className="!rounded-full !border !border-slate-300 !bg-white px-4 py-2 text-sm font-medium !text-slate-900 hover:!bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-100 dark:hover:!bg-slate-700"
                    >
                      克隆
                    </button>
                    {subscribed ? (
                      <button
                        type="button"
                        disabled={!canSub}
                        onClick={toggleSubscribe}
                        className="!rounded-full !border !border-slate-300 !bg-white px-4 py-2 text-sm font-medium !text-slate-800 hover:!bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-200 dark:hover:!bg-slate-700"
                      >
                        取消订阅
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!canSub}
                        onClick={toggleSubscribe}
                        className="!rounded-full !bg-slate-900 px-4 py-2 text-sm font-semibold !text-white hover:!bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:!bg-sky-600 dark:hover:!bg-sky-500"
                      >
                        订阅
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-8 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-0">
              <div className="sm:border-r sm:border-slate-100 sm:pr-6 dark:sm:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("skills.detailFieldCategory")}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{categoryDisplay}</p>
              </div>
              <div className="sm:border-r sm:border-slate-100 sm:px-6 dark:sm:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("skills.detailFieldSource")}</p>
                <p className="mt-1">
                  <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                    {sourceLabel}
                  </span>
                </p>
              </div>
              <div className="sm:border-r sm:border-slate-100 sm:px-6 dark:sm:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("skills.detailFieldRating")}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{ratingDisplay}</p>
              </div>
              <div className="sm:pl-6">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("skills.detailFieldUpdated")}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{updatedDisplay}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-none">
          <div className="border-b border-slate-200 px-6 dark:border-slate-700">
            <span className="inline-block border-b-2 border-slate-900 pb-3 pt-4 text-sm font-medium text-slate-900 dark:border-slate-200 dark:text-slate-100">
              {t("skills.detailTabFiles")}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">SKILL.md</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="下载"
                disabled={!canDl}
                onClick={downloadMd}
                className="inline-flex !rounded-lg !border-0 !bg-transparent p-2 !text-slate-600 !shadow-none hover:!bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:!text-slate-300 dark:hover:!bg-slate-800"
              >
                <Download className="size-4" />
              </button>
              <button
                type="button"
                title="预览"
                disabled={!canPv}
                onClick={() => canPv && setDocView("preview")}
                className={`inline-flex !rounded-lg !border-0 p-2 !shadow-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  docView === "preview"
                    ? "!bg-slate-200 !text-slate-900 dark:!bg-slate-700 dark:!text-slate-100"
                    : "!bg-transparent !text-slate-500 hover:!bg-slate-100 dark:!text-slate-400 dark:hover:!bg-slate-800"
                }`}
              >
                <Eye className="size-4" />
              </button>
              <button
                type="button"
                title="源码"
                disabled={!canSrc}
                onClick={() => canSrc && setDocView("raw")}
                className={`inline-flex !rounded-lg !border-0 p-2 !shadow-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  docView === "raw"
                    ? "!bg-slate-200 !text-slate-900 dark:!bg-slate-700 dark:!text-slate-100"
                    : "!bg-transparent !text-slate-500 hover:!bg-slate-100 dark:!text-slate-400 dark:hover:!bg-slate-800"
                }`}
              >
                <Code2 className="size-4" />
              </button>
            </div>
          </div>

          <div className="p-6">
            {docView === "preview" ? (
              <div className="rounded-xl border border-slate-100 bg-white px-5 py-6 dark:border-slate-700 dark:bg-slate-950/50 dark:[color-scheme:dark]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mb-3 text-2xl font-bold text-slate-900 dark:text-slate-100">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-900 dark:text-slate-100">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mb-2 mt-6 text-base font-semibold text-slate-900 dark:text-slate-100">{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p className="mb-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="mb-3 ml-5 list-disc text-sm text-slate-700 dark:text-slate-300">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="mb-3 ml-5 list-decimal text-sm text-slate-700 dark:text-slate-300">{children}</ol>
                    ),
                    li: ({ children }) => <li className="mb-1">{children}</li>,
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        className="text-sky-700 underline underline-offset-2 dark:text-sky-400"
                      >
                        {children}
                      </a>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="mb-3 border-l-4 border-slate-200 pl-4 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-400">
                        {children}
                      </blockquote>
                    ),
                    hr: () => <hr className="my-6 border-slate-200 dark:border-slate-700" />,
                    table: ({ children }) => (
                      <div className="mb-4 overflow-x-auto">
                        <table className="w-full border-collapse text-sm">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-slate-200 px-3 py-2 text-slate-700 dark:border-slate-700 dark:text-slate-300">
                        {children}
                      </td>
                    ),
                    pre: ({ children }) => (
                      <pre className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        {children}
                      </pre>
                    ),
                    code: ({ className, children }) => {
                      const block = /language-/.test(className ?? "");
                      if (block) {
                        return <code className={className}>{children}</code>;
                      }
                      return (
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.8rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <pre className="max-h-[min(70vh,520px)] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {markdown}
              </pre>
            )}
          </div>
        </section>

        {draftMode && !isBuiltinUi && canCloneCustomize ? (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">克隆与定制</h2>
              <button
                type="button"
                onClick={() => setDraftMode(false)}
                className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                收起
              </button>
            </div>
            <SkillEditor originalConfig={skill.config} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
