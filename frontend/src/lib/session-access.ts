import type { AccessControlState } from "@/lib/accessControlRuntime";
import { SUPER_ADMIN_ROLE_NAME, SUPER_ADMIN_USER_ID } from "@/lib/platform-auth";

export const SYSTEM_MODAL_MENUS = ["用户与权限", "MCP服务", "模型配置"] as const;
export type SystemModalMenu = (typeof SYSTEM_MODAL_MENUS)[number];

/** 与 `/api/auth/me` 一并下发给前端的权限摘要 */
export type ClientSessionAccessDto = {
  menuKeys: string[];
  buttonPermissions: Record<string, string[]>;
  allowedHrefs: string[];
  /** 是否展示侧栏「系统管理」入口：`sys-general` 或任一系统子模块（用户与权限 / MCP / 模型）在 `pages` 中 */
  canSystemSettings: boolean;
  /** 系统管理弹窗内可见的子菜单（与 `SYSTEM_MODAL_MENUS` 对齐） */
  allowedSystemMenus: SystemModalMenu[];
};

const LEAF_MENU_TO_HREF: Record<string, string> = {
  "menu-new-task": "/new-task",
  /** 技能中心拆为列表 / 详情叶键，路由仍同属 `/skills-center` */
  "menu-skills-center-list": "/skills-center",
  "menu-skills-center-detail": "/skills-center",
  "menu-task-center": "/task-center",
  "menu-data-center": "/data-center",
};

function hrefsFromMenuKeys(menuKeys: string[]): string[] {
  const s = new Set<string>();
  for (const k of menuKeys) {
    const h = LEAF_MENU_TO_HREF[k];
    if (h) s.add(h);
  }
  return [...s];
}

function systemMenusFromKeys(menuKeys: string[]): SystemModalMenu[] {
  const out: SystemModalMenu[] = [];
  if (menuKeys.some((k) => k.startsWith("sys-user-permission"))) out.push("用户与权限");
  if (menuKeys.includes("sys-mcp")) out.push("MCP服务");
  if (menuKeys.includes("sys-model")) out.push("模型配置");
  return out;
}

/** 与权限树叶子 `sys-general` 对齐：仅勾「常规」也应出现侧栏系统管理入口 */
const SYS_GENERAL_PAGE_KEY = "sys-general";

function canOpenSystemManagement(menuKeys: string[]): boolean {
  if (menuKeys.includes(SYS_GENERAL_PAGE_KEY)) return true;
  return systemMenusFromKeys(menuKeys).length > 0;
}

/**
 * 根据内存态「用户与权限」与当前会话用户，计算菜单页键、按钮权限、主导航 href 与是否可进系统管理。
 * 仅服务端路由调用（依赖 `getAccessControlRuntimeState`）。
 */
export function buildSessionAccess(
  state: AccessControlState,
  session: { sub: string; role: string },
): ClientSessionAccessDto {
  const user = state.users.find((u) => u.id === session.sub);
  if (!user) {
    return {
      menuKeys: [],
      buttonPermissions: {},
      allowedHrefs: [],
      canSystemSettings: false,
      allowedSystemMenus: [],
    };
  }

  const isSuper = user.id === SUPER_ADMIN_USER_ID || user.role === SUPER_ADMIN_ROLE_NAME;
  if (isSuper) {
    const superRole = state.roles.find((r) => r.id === "role-super");
    const menuKeys = superRole ? [...superRole.pages] : [];
    const buttonPermissions = superRole ? { ...superRole.buttonPermissions } : {};
    const allowedSystemMenus = systemMenusFromKeys(menuKeys);
    return {
      menuKeys,
      buttonPermissions,
      allowedHrefs: hrefsFromMenuKeys(menuKeys),
      canSystemSettings: canOpenSystemManagement(menuKeys),
      allowedSystemMenus,
    };
  }

  const role = state.roles.find((r) => r.name === user.role);
  if (!role) {
    return {
      menuKeys: [],
      buttonPermissions: {},
      allowedHrefs: [],
      canSystemSettings: false,
      allowedSystemMenus: [],
    };
  }

  const menuKeys = [...role.pages];
  const buttonPermissions = { ...role.buttonPermissions };
  const allowedSystemMenus = systemMenusFromKeys(menuKeys);
  return {
    menuKeys,
    buttonPermissions,
    allowedHrefs: hrefsFromMenuKeys(menuKeys),
    canSystemSettings: canOpenSystemManagement(menuKeys),
    allowedSystemMenus,
  };
}

/** 无可用路由时的兜底（与侧栏顺序一致） */
export function firstAllowedDashboardHref(allowedHrefs: string[]): string {
  const order = ["/new-task", "/skills-center", "/task-center", "/data-center"];
  for (const h of order) {
    if (allowedHrefs.includes(h)) return h;
  }
  return allowedHrefs[0] ?? "/new-task";
}

/**
 * 是否允许使用某叶子菜单下的某个按钮（与「用户与权限」里配置的文案一致）。
 * 已勾选页面但「按钮权限」全不选 → 仅可浏览对应区域，不可操作。
 * `access === null`（尚未拉到 /api/auth/me）时放行，避免首屏误锁超级管理员。
 */
export function canUsePageButton(
  access: ClientSessionAccessDto | null,
  pageKey: string,
  buttonLabel: string,
): boolean {
  if (!access) return true;
  if (!access.menuKeys.includes(pageKey)) return false;
  const allowed = access.buttonPermissions[pageKey];
  if (!allowed?.length) return false;
  return allowed.includes(buttonLabel);
}
