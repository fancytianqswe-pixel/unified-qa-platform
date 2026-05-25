"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Upload } from "lucide-react";
import { SkillCard } from "@/components/skills/SkillCard";
import {
  SKILL_CATALOG_SECTION_DEFAULT,
  SKILL_MARKET_CATEGORY_CHIPS,
  SKILL_MINE_KIND_CHIPS,
} from "@/components/skills/data";
import { Skill } from "@/components/skills/types";
import { loadLocalSkills, upsertLocalSkill } from "@/lib/skill-local-storage";
import { normalizeSkillBadgeLabel } from "@/lib/skill-badge-label";
import {
  fetchSkillsApiListFromNetwork,
  getCachedSkillsApiList,
  invalidateSkillsListCache,
} from "@/lib/skills-api-cache";
import { useI18n } from "@/i18n/I18nProvider";
import { useSessionAccess } from "@/components/layout/SessionAccessContext";
import { canUsePageButton } from "@/lib/session-access";

const PAGE_SKILLS_LIST = "menu-skills-center-list";

type TabKey = "market" | "mine";

function resolveMineKind(raw: Skill, listScope: "market" | "mine"): "platform" | "personal" | undefined {
  if (listScope !== "mine") return undefined;
  if (raw.mineKind === "platform" || raw.mineKind === "personal") return raw.mineKind;
  return raw.source === "user" ? "personal" : "platform";
}

function normalizeSkill(raw: Skill): Skill {
  const listScope = raw.listScope ?? (raw.source === "user" ? "mine" : "market");
  const mineKind = resolveMineKind(raw, listScope);
  const baseBadge =
    raw.badgeLabel ??
    (listScope === "mine"
      ? mineKind === "platform"
        ? "平台内置"
        : "个人"
      : raw.source === "user"
        ? "个人"
        : "市场");
  const badgeLabel = normalizeSkillBadgeLabel(baseBadge) ?? baseBadge;
  return {
    ...raw,
    listScope,
    mineKind,
    category: raw.category ?? "通用工具",
    catalogSection: raw.catalogSection ?? SKILL_CATALOG_SECTION_DEFAULT,
    badgeLabel,
  };
}

function trySkillFromUploadJson(text: string): Skill | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const name = String(o.name ?? "").trim();
    const description = String(o.description ?? "").trim();
    if (!id || !name || !description) return null;
    const cfg = o.config as Skill["config"] | undefined;
    const params = o.params as Skill["params"] | undefined;
    return normalizeSkill({
      id,
      icon: String(o.icon ?? "✨"),
      name,
      author: String(o.author ?? "我"),
      version: String(o.version ?? "1.0.0"),
      source: (o.source as Skill["source"]) === "user" ? "user" : "system",
      status: (o.status as Skill["status"]) ?? "draft",
      rating: Number(o.rating ?? 0),
      usageCount: Number(o.usageCount ?? 0),
      description,
      samplePrompt: String(o.samplePrompt ?? `请使用技能「${name}」完成以下任务：`),
      params:
        Array.isArray(params) && params.length
          ? (params as Skill["params"])
          : [{ key: "input", desc: "业务输入", required: true }],
      config:
        cfg && typeof cfg.url === "string" && typeof cfg.sql === "string" && typeof cfg.threshold === "number"
          ? cfg
          : { url: "https://example.com/placeholder", sql: "SELECT 1", threshold: 0.9 },
      category: String(o.category ?? "通用工具"),
      catalogSection: String(o.catalogSection ?? SKILL_CATALOG_SECTION_DEFAULT),
      badgeLabel: String(o.badgeLabel ?? "个人"),
      listScope: "mine",
      mineKind:
        o.mineKind === "platform" || o.mineKind === "personal"
          ? o.mineKind
          : (o.source as Skill["source"]) === "user"
            ? "personal"
            : "platform",
      deprecated: Boolean(o.deprecated),
    });
  } catch {
    return null;
  }
}

/**
 * 技能中心：市场精选 / 我的技能、搜索、分类筛选、上传与新建（生产级交互骨架）
 */
export function SkillsCenterPage() {
  const { t } = useI18n();
  const access = useSessionAccess();
  const canUpload = !access || canUsePageButton(access, PAGE_SKILLS_LIST, "上传技能包");
  const canNew = !access || canUsePageButton(access, PAGE_SKILLS_LIST, "新建技能");
  const canTabs = !access || canUsePageButton(access, PAGE_SKILLS_LIST, "市场与我的");
  const canSearch = !access || canUsePageButton(access, PAGE_SKILLS_LIST, "搜索与筛选");
  const [tab, setTab] = useState<TabKey>("market");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("全部");
  /** 「我的技能」内：全部 / 平台内置 / 个人 */
  const [mineKindFilter, setMineKindFilter] = useState<string>("全部");
  const [skills, setSkills] = useState<Skill[]>(() => {
    const raw = getCachedSkillsApiList();
    if (!raw?.length) return [];
    const localList = loadLocalSkills().map(normalizeSkill);
    const apiIds = new Set(raw.map((s) => s.id));
    return [...raw.map(normalizeSkill), ...localList.filter((s) => !apiIds.has(s.id))];
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    invalidateSkillsListCache();
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { list: apiListRaw, ok } = await fetchSkillsApiListFromNetwork();
        if (!active) return;
        if (!ok) {
          const localList = loadLocalSkills().map(normalizeSkill);
          setSkills((prev) => (prev.length ? prev : localList));
          setLoadError(t("skills.loadError"));
          return;
        }
        const apiList = apiListRaw.map(normalizeSkill);
        const localList = loadLocalSkills().map(normalizeSkill);
        const apiIds = new Set(apiList.map((s) => s.id));
        const merged = [...apiList, ...localList.filter((s) => !apiIds.has(s.id))];
        setSkills(merged);
        setLoadError(null);
      } catch {
        if (!active) return;
        const localList = loadLocalSkills().map(normalizeSkill);
        setSkills((prev) => (prev.length ? prev : localList));
        setLoadError(t("skills.loadError"));
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey, t]);

  const mineSkills = useMemo(() => skills.filter((s) => normalizeSkill(s).listScope === "mine"), [skills]);
  const marketSkills = useMemo(() => skills.filter((s) => normalizeSkill(s).listScope === "market"), [skills]);

  const baseList = tab === "market" ? marketSkills : mineSkills;

  const filtered = useMemo(() => {
    let rows = baseList;
    if (tab === "market" && category !== "全部") {
      rows = rows.filter((s) => (s.category ?? "通用工具") === category);
    }
    if (tab === "mine" && mineKindFilter !== "全部") {
      const want = mineKindFilter === "平台内置" ? "platform" : "personal";
      rows = rows.filter((s) => (normalizeSkill(s).mineKind ?? "personal") === want);
    }
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) =>
      `${s.name} ${s.description} ${s.author} ${s.samplePrompt} ${s.badgeLabel ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [baseList, category, mineKindFilter, query, tab]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const onUploadPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const skill = trySkillFromUploadJson(text);
      if (skill) {
        upsertLocalSkill(skill);
        reload();
        showToast(t("skills.toastImported", { name: skill.name }));
        return;
      }
      const loose = JSON.parse(text) as Record<string, unknown>;
      const name = String(loose.name ?? "").trim();
      const description = String(loose.description ?? loose.desc ?? "").trim();
      const scene = String(loose.scene ?? "upload").trim();
      if (!name || !description) {
        showToast(t("skills.toastJsonHint"));
        return;
      }
      const res = await fetch("/api/skills/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, scene }),
      });
      const data = (await res.json()) as { ok?: boolean; skillId?: string; version?: string; message?: string };
      if (!data.ok || !data.skillId) {
        showToast(data.message ?? t("skills.toastRegisterFail"));
        return;
      }
      const created = normalizeSkill({
        id: data.skillId,
        icon: "✨",
        name,
        author: "我",
        version: data.version ?? "1.0.0",
        source: "user",
        status: "draft",
        rating: 0,
        usageCount: 0,
        description,
        samplePrompt: `请使用技能「${name}」处理：`,
        params: [{ key: "task", desc: "任务描述", required: true }],
        config: { url: "https://example.com/placeholder", sql: "SELECT 1", threshold: 0.9 },
        category: "通用工具",
        badgeLabel: "个人",
        listScope: "mine",
      });
      upsertLocalSkill(created);
      reload();
      showToast(t("skills.toastRegistered"));
    } catch {
      showToast(t("skills.toastBadJson"));
    }
  };

  return (
    <main className="min-h-full bg-transparent pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        {/* 顶栏：无整行灰底/底框；筛选紧贴 Tab 行下方 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pb-0">
          <div className="flex shrink-0 items-center gap-6">
            <button
              type="button"
              disabled={!canTabs}
              onClick={() => {
                setTab("market");
                setCategory("全部");
                setMineKindFilter("全部");
              }}
              className={`relative !bg-transparent !px-0 !py-0 text-xl leading-none hover:!bg-transparent disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === "market"
                  ? "font-semibold text-slate-900 dark:text-slate-50"
                  : "font-medium text-slate-500 dark:text-slate-300"
              }`}
            >
              {t("skills.tabMarket")}
            </button>
            <button
              type="button"
              disabled={!canTabs}
              onClick={() => {
                setTab("mine");
                setMineKindFilter("全部");
              }}
              className={`relative !bg-transparent !px-0 !py-0 text-xl leading-none hover:!bg-transparent disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === "mine"
                  ? "font-semibold text-slate-900 dark:text-slate-50"
                  : "font-medium text-slate-500 dark:text-slate-300"
              }`}
            >
              {t("skills.tabMine")} <span className="tabular-nums">{mineSkills.length}</span>
            </button>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-end sm:gap-2 md:gap-3">
            <div className="relative w-full sm:w-[min(100%,260px)] md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                disabled={!canSearch}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("skills.searchPlaceholder")}
                className="!mt-0 h-10 w-full rounded-full border border-slate-200 bg-white py-0 pl-10 pr-4 text-sm text-slate-900 shadow-none placeholder:text-slate-400 focus:border-slate-300 focus:ring-1 focus:ring-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/80"
              />
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onUploadPick} />
              <button
                type="button"
                disabled={!canUpload}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-10 items-center gap-1.5 !rounded-xl !bg-slate-200 px-4 text-sm font-medium !text-slate-900 hover:!bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="size-4 shrink-0" />
                {t("skills.upload")}
              </button>
              <Link
                href={canNew ? "/new-task?workspacePreset=new-skill" : "#"}
                aria-disabled={!canNew}
                onClick={(e) => {
                  if (!canNew) e.preventDefault();
                }}
                className={`inline-flex h-10 items-center gap-1.5 !rounded-xl px-4 text-sm font-medium !text-white transition ${
                  canNew ? "!bg-black hover:!bg-slate-900" : "!cursor-not-allowed !bg-slate-400 opacity-60"
                }`}
              >
                <Plus className="size-4 shrink-0 text-white" strokeWidth={2.5} />
                {t("skills.newSkill")}
              </Link>
            </div>
          </div>
        </div>

        {tab === "market" ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {SKILL_MARKET_CATEGORY_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!canSearch}
                onClick={() => setCategory(c)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  category === c
                    ? "border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-50"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {t(`skills.cat.${c}`)}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {SKILL_MINE_KIND_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!canSearch}
                onClick={() => setMineKindFilter(c)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  mineKindFilter === c
                    ? "border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-50"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {t(`skills.mine.${c}`)}
              </button>
            ))}
          </div>
        )}

        {toast ? (
          <div
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            role="status"
          >
            {toast}
          </div>
        ) : null}

        {loadError ? <p className="mt-4 text-sm text-amber-800">{loadError}</p> : null}

        <section className="mt-6">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center dark:border-slate-600 dark:bg-slate-900/80">
              <p className="text-base font-medium text-slate-800 dark:text-slate-100">{t("skills.emptyTitle")}</p>
              <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                {tab === "mine"
                  ? t("skills.emptyMineBody")
                  : query.trim()
                    ? t("skills.emptyMarketQuery")
                    : t("skills.emptyMarketBody")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((s) => (
                <SkillCard key={s.id} skill={normalizeSkill(s)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
