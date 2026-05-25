"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserPermissionSection } from "@/components/admin/UserPermissionSection";
import { MarketSection } from "@/components/admin/MarketSection";
import { PlatformConfigSection } from "@/components/admin/PlatformConfigSection";
import { GeneralSettingsSection } from "@/components/admin/GeneralSettingsSection";
import { useI18n } from "@/i18n/I18nProvider";
import { intlLocaleForApp } from "@/lib/ui-preferences";
import { setDataScopeUserId, getDataScopeUserId } from "@/lib/client-data-scope";
import { firstAllowedDashboardHref, type ClientSessionAccessDto } from "@/lib/session-access";
import { SessionAccessProvider } from "@/components/layout/SessionAccessContext";
import { useChatStore, rehydrateChatStoreForDataScope } from "@/store/chatStore";
import { invalidateSkillsCachesForListAndDetail } from "@/lib/skills-api-cache";
import { getUserAvatarGlyph } from "@/lib/user-avatar-glyph";
import { safeDecodeURIComponent } from "@/lib/safe-decode-uri";
import {
  Blocks,
  Database,
  Ellipsis,
  FolderClock,
  History,
  PencilLine,
  PlusSquare,
  Settings,
  SidebarClose,
  SidebarOpen,
  Trash2,
  X,
} from "lucide-react";

type Props = {
  children: React.ReactNode;
};

const MAIN_MENU_DEFS = [
  { href: "/new-task", titleKey: "nav.newTask", Icon: PlusSquare },
  { href: "/skills-center", titleKey: "nav.skillsCenter", Icon: Blocks },
  { href: "/task-center", titleKey: "nav.taskCenter", Icon: FolderClock },
  { href: "/data-center", titleKey: "nav.dataCenter", Icon: Database },
] as const;

const HEADER_DEFS = [
  { match: "/new-task", titleKey: "nav.newTask" },
  { match: "/conversation", titleKey: "header.conversation" },
  { match: "/skills-center", titleKey: "nav.skillsCenter" },
  { match: "/task-center", titleKey: "nav.taskCenter" },
  { match: "/data-center", titleKey: "nav.dataCenter" },
] as const;

const BACKEND_SYSTEM_MENUS = ["用户与权限", "MCP服务", "模型配置"] as const;
type BackendSystemMenu = (typeof BACKEND_SYSTEM_MENUS)[number];
type SystemMenu = "常规" | BackendSystemMenu;

const SYSTEM_MENU_TKEY: Record<SystemMenu, string> = {
  常规: "system.menu.general",
  用户与权限: "system.menu.users",
  MCP服务: "system.menu.mcp",
  模型配置: "system.menu.models",
};

function requiredHrefForPath(pathname: string): string | null {
  if (pathname.startsWith("/new-task") || pathname.startsWith("/conversation")) return "/new-task";
  if (pathname.startsWith("/skills-center")) return "/skills-center";
  if (pathname.startsWith("/task-center")) return "/task-center";
  if (pathname.startsWith("/data-center")) return "/data-center";
  return null;
}

type HistoryBucket = {
  label: string;
  items: Array<{ id: string; title: string; timeText: string; href: string; createdAt: string }>;
};

function simplifyConversationTitle(raw: string, defaultTitle: string) {
  const cleaned = raw
    .replace(/\[.*?\]/g, " ")
    .replace(/请使用|请基于|请帮我|请|使用/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const simplified = cleaned.replace(/[，。！？、；：,.!?;:]/g, " ").replace(/\s+/g, " ").trim();
  return simplified || defaultTitle;
}

function sameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildHistoryBuckets(
  sessions: Array<{ id: string; title: string; href: string; createdAt: string }>,
  labels: { today: string; yesterday: string; last7: string },
  intlLocale: string,
): HistoryBucket[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const monthFormatter = new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long" });
  const yearFormatter = new Intl.DateTimeFormat(intlLocale, { year: "numeric" });

  const map = new Map<string, HistoryBucket["items"]>();
  sessions
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((session) => {
      const d = new Date(session.createdAt);
      const timeText = d.toLocaleString(intlLocale, { hour: "2-digit", minute: "2-digit" });
      let label = "";
      if (sameDate(d, today)) label = labels.today;
      else if (sameDate(d, yesterday)) label = labels.yesterday;
      else if (d >= sevenDaysAgo) label = labels.last7;
      else if (d.getFullYear() === now.getFullYear()) label = monthFormatter.format(d);
      else label = yearFormatter.format(d);

      const bucket = map.get(label) ?? [];
      bucket.push({ ...session, timeText });
      map.set(label, bucket);
    });

  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

/**
 * DashboardShell 提供左右 1:5 的仪表盘框架。
 */
export function DashboardShell({ children }: Props) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const isConversationPage = pathname.startsWith("/conversation/");
  /** 新任务与历史会话共用「固定视口高度 + flex 列」，否则内层 `flex-1`/`h-full` 无法贴底，首包等待时输入区会悬在页面中部 */
  const isChatViewportColumn =
    pathname.startsWith("/conversation/") || pathname === "/new-task" || pathname.startsWith("/new-task/");
  const [collapsed, setCollapsed] = useState(false);
  const [showSystemModal, setShowSystemModal] = useState(false);
  const [activeSystemMenu, setActiveSystemMenu] = useState<SystemMenu>("常规");
  const historySessions = useChatStore((s) => s.historySessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const renameHistorySession = useChatStore((s) => s.renameHistorySession);
  const deleteHistorySession = useChatStore((s) => s.deleteHistorySession);
  const openSession = useChatStore((s) => s.openSession);
  const enterNewTaskWorkspace = useChatStore((s) => s.enterNewTaskWorkspace);
  const [openHistoryMenuId, setOpenHistoryMenuId] = useState<string | null>(null);
  const [renamingHistoryId, setRenamingHistoryId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    name: string;
    account: string;
    role: string;
  } | null>(null);
  const [sessionAccess, setSessionAccess] = useState<ClientSessionAccessDto | null>(null);

  const sideWidthClass = useMemo(() => (collapsed ? "w-20" : "w-64"), [collapsed]);
  const avatarGlyph = useMemo(
    () => getUserAvatarGlyph(sessionUser?.name || sessionUser?.account || ""),
    [sessionUser?.name, sessionUser?.account],
  );

  const visibleMainMenus = useMemo(() => {
    if (!sessionAccess?.allowedHrefs?.length) return [...MAIN_MENU_DEFS];
    const allow = new Set(sessionAccess.allowedHrefs);
    const next = MAIN_MENU_DEFS.filter((m) => allow.has(m.href));
    return next.length ? next : MAIN_MENU_DEFS.filter((m) => m.href === "/new-task");
  }, [sessionAccess]);

  const visibleSystemMenus = useMemo((): SystemMenu[] => {
    if (!sessionAccess) return ["常规", ...BACKEND_SYSTEM_MENUS];
    if (!sessionAccess.canSystemSettings) return [];
    const allow = new Set(sessionAccess.allowedSystemMenus);
    const rest = BACKEND_SYSTEM_MENUS.filter((m) => allow.has(m));
    return ["常规", ...rest];
  }, [sessionAccess]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setDataScopeUserId(null);
    setSessionUser(null);
    setSessionAccess(null);
    await rehydrateChatStoreForDataScope();
    router.push("/");
  }
  const intlLocale = intlLocaleForApp(locale);
  const currentHeader = useMemo(() => {
    if (pathname.startsWith("/conversation/")) {
      const fromPath = pathname.split("/conversation/")[1] ?? "";
      const sessionId = safeDecodeURIComponent(fromPath);
      const hit = historySessions.find((item) => item.id === sessionId);
      return { title: simplifyConversationTitle(hit?.title || "", t("history.currentSession")) };
    }
    const hit = HEADER_DEFS.find((item) => pathname.startsWith(item.match));
    return { title: hit ? t(hit.titleKey) : t("header.defaultTitle") };
  }, [pathname, historySessions, t]);
  const historyBuckets = useMemo(
    () =>
      buildHistoryBuckets(
        historySessions,
        {
          today: t("history.today"),
          yesterday: t("history.yesterday"),
          last7: t("history.last7Days"),
        },
        intlLocale,
      ),
    [historySessions, t, intlLocale],
  );

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!historyMenuRef.current) return;
      if (!historyMenuRef.current.contains(e.target as Node)) {
        setOpenHistoryMenuId(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    if (!currentSessionId || !historyScrollRef.current) return;
    const target = historyScrollRef.current.querySelector<HTMLElement>(
      `[data-history-session-id="${currentSessionId}"]`,
    );
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentSessionId, historyBuckets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const json = (await res.json()) as {
          ok?: boolean;
          user?: { id?: string; name?: string; account?: string; role?: string };
          access?: ClientSessionAccessDto;
        };
        if (!cancelled && res.ok && json.ok && json.user?.id) {
          const uid = json.user.id;
          const prevScope = getDataScopeUserId();
          setDataScopeUserId(uid);
          if (prevScope !== uid) {
            await rehydrateChatStoreForDataScope();
            invalidateSkillsCachesForListAndDetail();
          }
          setSessionUser({
            id: uid,
            name: json.user.name ?? "",
            account: json.user.account ?? "",
            role: json.user.role ?? "",
          });
          setSessionAccess(json.access ?? null);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionAccess || !sessionUser) return;
    if (pathname.startsWith("/system-settings")) {
      if (!sessionAccess.canSystemSettings) {
        router.replace(firstAllowedDashboardHref(sessionAccess.allowedHrefs));
      }
      return;
    }
    if (!sessionAccess.allowedHrefs?.length) return;
    const need = requiredHrefForPath(pathname);
    if (!need) return;
    if (!sessionAccess.allowedHrefs.includes(need)) {
      router.replace(firstAllowedDashboardHref(sessionAccess.allowedHrefs));
    }
  }, [pathname, sessionAccess, sessionUser, router]);

  useEffect(() => {
    if (!showSystemModal || !sessionAccess) return;
    if (visibleSystemMenus.length && !visibleSystemMenus.includes(activeSystemMenu)) {
      setActiveSystemMenu(visibleSystemMenus[0]!);
    }
  }, [showSystemModal, sessionAccess, activeSystemMenu, visibleSystemMenus]);

  useEffect(() => {
    if (!showSystemModal) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [showSystemModal]);

  return (
    <SessionAccessProvider value={sessionAccess}>
    <div className="flex min-h-screen bg-[#FCFCFA] dark:bg-slate-950">
      <aside
        className={`${sideWidthClass} sticky top-0 h-screen min-h-0 self-start flex shrink-0 flex-col border-r border-gray-100 bg-white p-3 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900`}
      >
        <div className="relative z-30 mb-3">
          {collapsed ? (
            <div className="flex w-full flex-col items-center gap-2 rounded-2xl bg-white p-2 dark:bg-slate-900">
              <div className="flex flex-col items-center">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  {avatarGlyph}
                </div>
              </div>
              <button
                type="button"
                title={t("nav.expandSidebar")}
                className="flex size-9 shrink-0 items-center justify-center !rounded-xl !bg-transparent text-sm !text-gray-500 hover:!bg-gray-50 dark:!text-slate-400 dark:hover:!bg-slate-800"
                onClick={() => setCollapsed(false)}
              >
                <SidebarOpen className="size-5 shrink-0" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-white p-2 dark:bg-slate-900">
              <div className="relative flex min-w-0 flex-1 items-center gap-2 py-0.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  {avatarGlyph}
                </div>
                <div className="min-w-0 flex-1 pr-1 text-left">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {sessionUser?.account || "…"}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{sessionUser?.role || "…"}</p>
                </div>
              </div>
              <button
                type="button"
                title={t("nav.collapseSidebar")}
                className="flex shrink-0 items-center justify-center !rounded-xl !bg-transparent px-3 py-2 text-sm !text-gray-500 hover:!bg-gray-50 dark:!text-slate-400 dark:hover:!bg-slate-800"
                onClick={() => setCollapsed(true)}
              >
                <SidebarClose className="size-5 shrink-0" />
              </button>
            </div>
          )}
        </div>

        <nav
          className={`relative z-0 space-y-1 ${collapsed ? "flex flex-col items-center" : ""}`}
        >
          {visibleMainMenus.map((menu) => {
            const active = menu.href === "/new-task" ? pathname === "/new-task" : pathname === menu.href;
            const Icon = menu.Icon;
            const label = t(menu.titleKey);
            return (
              <Link
                key={menu.href}
                href={menu.href}
                className={`flex items-center rounded-xl text-sm transition ${
                  collapsed
                    ? `size-9 shrink-0 justify-center p-0 ${active ? "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300" : "text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-800"}`
                    : `gap-2 px-3 py-2 ${active ? "bg-blue-50 text-blue-600 rounded-xl dark:bg-blue-950/60 dark:text-blue-300" : "text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-800"}`
                }`}
                title={label}
                onClick={() => {
                  if (menu.href === "/new-task") {
                    enterNewTaskWorkspace();
                  }
                }}
              >
                <Icon className="size-5 shrink-0" />
                {!collapsed ? <span>{label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className={collapsed ? "mt-3" : "mt-4"}>
          {!collapsed ? (
            <p className="mb-2 px-1 text-xs font-semibold text-gray-500 dark:text-slate-400">{t("nav.historyTasks")}</p>
          ) : null}
        </div>
        <div
          className={`min-h-0 overflow-hidden rounded-2xl bg-gray-50 p-2 dark:bg-slate-800/40 ${
            collapsed
              ? "flex w-full flex-none shrink-0 flex-col items-center"
              : "flex min-h-0 flex-1 flex-col"
          }`}
        >
          {!collapsed ? (
            <>
              <div
                ref={historyScrollRef}
                className="chat-scroll-area min-h-0 flex-1 overflow-y-auto pr-1"
              >
                {historyBuckets.map((bucket) => (
                  <div key={bucket.label} className="mb-3">
                    <p className="mb-1 px-1 text-[11px] font-semibold text-gray-400 dark:text-slate-500">{bucket.label}</p>
                    <div className="space-y-1">
                      {bucket.items.map((item) => (
                        <div
                          key={item.id}
                          data-history-session-id={item.id}
                          className={`group relative rounded-lg px-1 py-1 hover:bg-white/80 dark:hover:bg-slate-700/60 ${
                            item.id === currentSessionId ? "bg-blue-50/70 dark:bg-blue-950/40" : ""
                          }`}
                        >
                          {renamingHistoryId === item.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                value={renamingValue}
                                autoFocus
                                className="!mt-0 h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                onChange={(e) => setRenamingValue(e.target.value)}
                                onBlur={() => {
                                  renameHistorySession(item.id, renamingValue);
                                  setRenamingHistoryId(null);
                                  setOpenHistoryMenuId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    renameHistorySession(item.id, renamingValue);
                                    setRenamingHistoryId(null);
                                    setOpenHistoryMenuId(null);
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className="flex items-start gap-1">
                              <Link
                                href={`/conversation/${encodeURIComponent(item.id)}`}
                                className="min-w-0 flex-1"
                                onClick={() => {
                                  openSession(item.id);
                                }}
                              >
                                <p className="truncate text-sm text-gray-800 dark:text-slate-100">
                                  {item.title || t("history.currentSession")}
                                </p>
                              </Link>
                              <div ref={openHistoryMenuId === item.id ? historyMenuRef : null} className="relative">
                                <button
                                  type="button"
                                  title={t("history.moreActions")}
                                  className={`!bg-transparent p-1 text-slate-400 transition-opacity hover:text-slate-600 ${
                                    openHistoryMenuId === item.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                  }`}
                                  onClick={() =>
                                    setOpenHistoryMenuId((prev) => (prev === item.id ? null : item.id))
                                  }
                                >
                                  <Ellipsis className="size-4" />
                                </button>
                                {openHistoryMenuId === item.id ? (
                                  <div className="absolute right-0 top-6 z-20 w-28 rounded-xl border border-slate-200 bg-white p-1 shadow-md dark:border-slate-600 dark:bg-slate-900">
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm !bg-transparent text-slate-700 hover:!bg-slate-100 dark:text-slate-200 dark:hover:!bg-slate-800"
                                      onClick={() => {
                                        setRenamingHistoryId(item.id);
                                        setRenamingValue(item.title || "");
                                      }}
                                    >
                                      <PencilLine className="size-3.5" />
                                      {t("history.rename")}
                                    </button>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm !bg-transparent text-rose-600 hover:!bg-rose-50 dark:hover:!bg-rose-950/40"
                                      onClick={() => {
                                        const deletedId = item.id;
                                        const pathSessionId =
                                          pathname.startsWith("/conversation/") &&
                                          pathname.length > "/conversation/".length
                                            ? safeDecodeURIComponent(pathname.slice("/conversation/".length))
                                            : "";
                                        const viewingDeleted =
                                          !!pathSessionId && pathSessionId === deletedId;
                                        const willBeEmpty = historySessions.length <= 1;

                                        deleteHistorySession(deletedId);

                                        // 删除后若历史为空，或删的是当前正在看的会话 URL，避免留在空「当前会话」页
                                        if (willBeEmpty || viewingDeleted) {
                                          enterNewTaskWorkspace();
                                          router.push("/new-task");
                                        }
                                        setOpenHistoryMenuId(null);
                                      }}
                                    >
                                      <Trash2 className="size-3.5" />
                                      {t("history.delete")}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex w-full flex-col items-center gap-2 py-0.5">
              {historySessions.slice(0, 7).map((item) => (
                <Link
                  key={item.id}
                  href={`/conversation/${encodeURIComponent(item.id)}`}
                  onClick={() => {
                    openSession(item.id);
                  }}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-600 hover:bg-white/90 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  title={item.title}
                >
                  <History className="size-5" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {(sessionAccess == null || sessionAccess.canSystemSettings) ? (
        <div className={`mt-3 ${collapsed ? "flex justify-center" : ""}`}>
          <button
            type="button"
            onClick={() => {
              setActiveSystemMenu("常规");
              setShowSystemModal(true);
            }}
            className={`flex items-center gap-2 rounded-xl text-sm transition !bg-transparent !text-gray-500 hover:!bg-gray-50 dark:!text-slate-400 dark:hover:!bg-slate-800 ${
              collapsed ? "size-9 shrink-0 justify-center p-0" : "w-full px-3 py-2"
            }`}
            title={t("nav.systemSettings")}
          >
            <Settings className="size-5 shrink-0" />
            {!collapsed ? <span>{t("nav.systemSettings")}</span> : null}
          </button>
        </div>
        ) : null}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-11 items-center border-b border-gray-100 bg-white px-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-gray-800 dark:text-slate-100">{currentHeader.title}</p>
          </div>
        </header>
        <main
          className={`bg-[#FCFCFA] dark:bg-slate-950 ${
            isChatViewportColumn
              ? `flex h-[calc(100vh-2.75rem)] min-h-0 flex-col ${
                  isConversationPage ? "pl-6 pr-3 pb-3 pt-1" : "p-6"
                }`
              : "min-h-[calc(100vh-2.75rem)] p-6"
          }`}
        >
          {children}
        </main>
      </div>

      {showSystemModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden overscroll-none bg-black/15 p-3 dark:bg-black/40 md:items-center">
          <div className="flex h-[90vh] w-full max-w-[1040px] overflow-hidden rounded-[24px] border border-slate-300 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900">
            <aside className="sticky top-0 z-[1] flex h-full max-h-[90vh] w-[210px] shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-[#efefee] p-4 dark:bg-slate-800">
              <h2 className="mb-4 px-3 text-base font-bold text-slate-900 dark:text-slate-100">{t("system.modalTitle")}</h2>
              <div className="space-y-1">
                {visibleSystemMenus.map((menu) => (
                  <button
                    key={menu}
                    type="button"
                    onClick={() => setActiveSystemMenu(menu)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      activeSystemMenu === menu
                        ? "!bg-[#dcdcd8] !text-slate-900 dark:!bg-slate-600 dark:!text-slate-50"
                        : "!bg-transparent !text-slate-700 hover:!bg-[#e4e4e1] dark:!text-slate-200 dark:hover:!bg-slate-700/80"
                    }`}
                  >
                    {t(SYSTEM_MENU_TKEY[menu])}
                  </button>
                ))}
              </div>
            </aside>
            <section className="flex min-w-0 flex-1 min-h-0 flex-col bg-white dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t(SYSTEM_MENU_TKEY[activeSystemMenu])}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSystemModal(false)}
                  className="!bg-transparent p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  title={t("system.close")}
                >
                  <X className="size-6" />
                </button>
              </div>
              <div
                className={`flex-1 min-h-0 bg-[#fbfbfb] p-6 dark:bg-slate-950 ${
                  activeSystemMenu === "用户与权限" ? "overflow-hidden" : "overflow-y-auto"
                }`}
              >
                {activeSystemMenu === "常规" && sessionUser ? (
                  <GeneralSettingsSection
                    displayName={sessionUser.name || sessionUser.account}
                    role={sessionUser.role}
                    onLogout={logout}
                  />
                ) : activeSystemMenu === "常规" ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</p>
                ) : null}
                {activeSystemMenu === "用户与权限" ? <UserPermissionSection /> : null}
                {activeSystemMenu === "MCP服务" ? <MarketSection mode="mcp" /> : null}
                {activeSystemMenu === "模型配置" ? <PlatformConfigSection mode="model" /> : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
    </SessionAccessProvider>
  );
}

