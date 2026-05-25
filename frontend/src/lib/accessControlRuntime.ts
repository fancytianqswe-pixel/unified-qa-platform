import { NORMAL_USER_ROLE_ID, ROOT_PLATFORM_ORG_ID } from "@/lib/access-control-constants";
import { hashPasswordForUser } from "@/lib/password-auth";
import {
  SINGLE_SUPER_ADMIN_DEPLOYMENT,
  SUPER_ADMIN_ACCOUNT,
  SUPER_ADMIN_DISPLAY_NAME,
  SUPER_ADMIN_PASSWORD,
  SUPER_ADMIN_ROLE_NAME,
  SUPER_ADMIN_USER_ID,
} from "@/lib/platform-auth";

export { NORMAL_USER_ROLE_ID, ROOT_PLATFORM_ORG_ID } from "@/lib/access-control-constants";

type AppRole = "超级管理员" | "普通用户" | string;

export type OrgNode = {
  id: string;
  name: string;
  children: OrgNode[];
};

export type UserRow = {
  id: string;
  name: string;
  account: string;
  role: AppRole;
  orgId: string;
  /** 服务端内存态；GET 与 POST 响应中不下发 */
  passwordHash?: string;
};

export type RoleRow = {
  id: string;
  name: AppRole;
  pages: string[];
  buttonPermissions: Record<string, string[]>;
};

export type AccessControlState = {
  orgTree: OrgNode[];
  users: UserRow[];
  roles: RoleRow[];
  updatedAt: string;
};

const SKILL_CENTER_LEGACY = "menu-skills-center";
const SKILL_CENTER_LIST = "menu-skills-center-list";
const SKILL_CENTER_DETAIL = "menu-skills-center-detail";
const SKILL_LIST_BUTTONS = ["上传技能包", "新建技能", "市场与我的", "搜索与筛选"];
const SKILL_DETAIL_BUTTONS = ["订阅管理", "克隆与定制", "下载文档", "文档预览", "文档源码"];

/** 旧版单一 `menu-skills-center` 叶键迁移为列表 + 详情两级，并合并按钮 */
function migrateLegacySkillCenterRole(row: RoleRow): RoleRow {
  if (!row.pages.includes(SKILL_CENTER_LEGACY)) return row;
  const pages = new Set(row.pages.filter((k) => k !== SKILL_CENTER_LEGACY));
  pages.add(SKILL_CENTER_LIST);
  pages.add(SKILL_CENTER_DETAIL);
  const bp = { ...row.buttonPermissions };
  const legacy = bp[SKILL_CENTER_LEGACY];
  delete bp[SKILL_CENTER_LEGACY];
  const listPick = new Set<string>();
  const detailPick = new Set<string>();
  if (legacy?.length) {
    for (const b of legacy) {
      if (b === "一键试用") {
        listPick.add("搜索与筛选");
        detailPick.add("文档预览");
      } else if (b === "订阅" || b === "取消订阅") {
        detailPick.add("订阅管理");
      } else if (b === "克隆") {
        detailPick.add("克隆与定制");
      }
    }
  }
  bp[SKILL_CENTER_LIST] = listPick.size ? [...listPick] : [...SKILL_LIST_BUTTONS];
  bp[SKILL_CENTER_DETAIL] = detailPick.size ? [...detailPick] : [...SKILL_DETAIL_BUTTONS];
  return { ...row, pages: [...pages], buttonPermissions: bp };
}

const permissionTree = [
  { key: "menu-new-task", buttons: ["发送", "上传附件", "技能", "模型选择", "语音输入"] },
  {
    key: "menu-skills-center",
    children: [
      {
        key: SKILL_CENTER_LIST,
        buttons: [...SKILL_LIST_BUTTONS],
      },
      {
        key: SKILL_CENTER_DETAIL,
        buttons: [...SKILL_DETAIL_BUTTONS],
      },
    ],
  },
  { key: "menu-task-center", buttons: ["查看详情", "重跑", "停止", "查看结果查询明细", "查看报告中心"] },
  { key: "menu-data-center", buttons: ["新增数据源", "更新字段", "获取数据", "保存字段", "编辑", "删除"] },
  {
    key: "menu-system",
    children: [
      /** 系统管理弹窗首项「常规」（语言/主题/退出）；与侧栏 `DashboardShell` 一致 */
      { key: "sys-general", buttons: [] },
      {
        key: "sys-user-permission",
        children: [
          { key: "sys-user-permission-user", buttons: ["新增组织", "删除组织", "新增用户", "删除用户"] },
          { key: "sys-user-permission-role", buttons: ["新增角色", "保存", "配置按钮"] },
        ],
      },
      { key: "sys-mcp", buttons: ["添加", "编辑", "删除", "启用停用", "导出JSON", "测试连接", "内置开关"] },
      { key: "sys-model", buttons: ["新增模型", "测试连接", "保存配置", "编辑", "删除"] },
    ],
  },
] as const;

function flattenLeafNodes(nodes: readonly { key: string; buttons?: readonly string[]; children?: readonly any[] }[]): {
  key: string;
  buttons: string[];
}[] {
  return nodes.flatMap((node) => {
    if (node.children?.length) return flattenLeafNodes(node.children);
    return [{ key: node.key, buttons: [...(node.buttons ?? [])] }];
  });
}

const leafNodes = flattenLeafNodes(permissionTree);
const allLeafKeys = leafNodes.map((item) => item.key);
const allButtonPermissions = Object.fromEntries(leafNodes.map((item) => [item.key, item.buttons]));

function cloneOrg(nodes: OrgNode[]): OrgNode[] {
  return nodes.map((n) => ({ ...n, children: cloneOrg(n.children) }));
}

function cloneUsers(rows: UserRow[]): UserRow[] {
  return rows.map((row) => ({ ...row }));
}

function cloneRoles(rows: RoleRow[]): RoleRow[] {
  return rows.map((row) => ({
    ...row,
    pages: [...row.pages],
    buttonPermissions: Object.fromEntries(Object.entries(row.buttonPermissions).map(([k, v]) => [k, [...v]])),
  }));
}

const superAdminUserTemplate: UserRow = {
  id: SUPER_ADMIN_USER_ID,
  name: SUPER_ADMIN_DISPLAY_NAME,
  account: SUPER_ADMIN_ACCOUNT,
  role: SUPER_ADMIN_ROLE_NAME,
  orgId: ROOT_PLATFORM_ORG_ID,
};

const superAdminRoleTemplate: RoleRow = {
  id: "role-super",
  name: SUPER_ADMIN_ROLE_NAME,
  pages: [...allLeafKeys],
  buttonPermissions: { ...allButtonPermissions },
};

/** 内置「普通用户」：新用户默认角色；与历史 merge 逻辑一致 */
const normalUserRoleTemplate: RoleRow = {
  id: NORMAL_USER_ROLE_ID,
  name: "普通用户",
  pages: ["menu-new-task", "menu-task-center"],
  buttonPermissions: {
    "menu-new-task": ["发送", "技能"],
    "menu-task-center": ["查看详情"],
  },
};

/**
 * 保证存在可登录的超级管理员行、且与「单超级管理员」部署策略一致；合并写库前与 GET 返回前调用。
 */
export function mergeAccessControlInvariant(
  next: Pick<AccessControlState, "orgTree" | "users" | "roles">,
): Pick<AccessControlState, "orgTree" | "users" | "roles"> {
  let users = cloneUsers(next.users).filter((u) => u.account !== SUPER_ADMIN_ACCOUNT || u.id === SUPER_ADMIN_USER_ID);
  const idx = users.findIndex((u) => u.id === SUPER_ADMIN_USER_ID);
  if (idx < 0) {
    users = [superAdminUserTemplate, ...users];
  } else {
    const cur = users[idx]!;
    users[idx] = {
      ...superAdminUserTemplate,
      ...cur,
      id: SUPER_ADMIN_USER_ID,
      account: SUPER_ADMIN_ACCOUNT,
      role: SUPER_ADMIN_ROLE_NAME,
      name: cur.name?.trim() ? cur.name : SUPER_ADMIN_DISPLAY_NAME,
      orgId: cur.orgId || ROOT_PLATFORM_ORG_ID,
    };
  }

  if (SINGLE_SUPER_ADMIN_DEPLOYMENT) {
    users = users.filter((u) => u.id === SUPER_ADMIN_USER_ID);
  }

  let roles = cloneRoles(next.roles);
  if (!roles.some((r) => r.id === "role-super")) {
    roles = [superAdminRoleTemplate, ...roles];
  } else {
    roles = roles.map((r) => {
      if (r.id !== "role-super") return r;
      /** 新增叶子（如 `sys-general`）须并入超级管理员，避免持久化旧 `pages` 覆盖模板后丢权 */
      const mergedPages = Array.from(new Set([...allLeafKeys, ...r.pages]));
      const mergedBp: Record<string, string[]> = {};
      for (const key of mergedPages) {
        const fromRole = r.buttonPermissions[key];
        const defaults = allButtonPermissions[key] ?? [];
        mergedBp[key] = fromRole !== undefined ? [...fromRole] : [...defaults];
      }
      return {
        ...superAdminRoleTemplate,
        ...r,
        id: "role-super",
        name: SUPER_ADMIN_ROLE_NAME,
        pages: mergedPages,
        buttonPermissions: mergedBp,
      };
    });
  }

  if (SINGLE_SUPER_ADMIN_DEPLOYMENT) {
    roles = roles.filter((r) => r.id === "role-super");
  } else if (!roles.some((r) => r.id === NORMAL_USER_ROLE_ID)) {
    roles = [...roles, cloneRoles([normalUserRoleTemplate])[0]!];
  }

  roles = roles.map(migrateLegacySkillCenterRole);

  users = users.map((user) => {
    if (user.passwordHash && user.passwordHash.length > 0) return user;
    const defaultPlain = user.id === SUPER_ADMIN_USER_ID ? SUPER_ADMIN_PASSWORD : user.account;
    return { ...user, passwordHash: hashPasswordForUser(defaultPlain, user.id) };
  });

  return { orgTree: cloneOrg(next.orgTree), users, roles };
}

/** 返回给浏览器前移除 passwordHash，避免泄露 */
export function sanitizeAccessControlForClient(state: AccessControlState): AccessControlState {
  return {
    ...state,
    orgTree: cloneOrg(state.orgTree),
    users: state.users.map(({ passwordHash: _h, ...rest }) => ({ ...rest })),
    roles: cloneRoles(state.roles),
    updatedAt: state.updatedAt,
  };
}

function createDefaultState(): AccessControlState {
  const orgTree: OrgNode[] = [
    {
      id: ROOT_PLATFORM_ORG_ID,
      name: "平台",
      children: [],
    },
  ];
  const merged = mergeAccessControlInvariant({
    orgTree,
    users: [superAdminUserTemplate],
    roles: [superAdminRoleTemplate, normalUserRoleTemplate],
  });
  return { ...merged, updatedAt: new Date().toISOString() };
}

type RuntimeState = {
  state: AccessControlState;
};

declare global {
  var __accessControlRuntimeState: RuntimeState | undefined;
}

export function getAccessControlRuntimeState(): AccessControlState {
  if (!globalThis.__accessControlRuntimeState) {
    globalThis.__accessControlRuntimeState = { state: createDefaultState() };
  }
  const raw = globalThis.__accessControlRuntimeState.state;
  const merged = mergeAccessControlInvariant(raw);
  const changed =
    merged.users.length !== raw.users.length ||
    merged.roles.length !== raw.roles.length ||
    JSON.stringify(merged.users) !== JSON.stringify(raw.users) ||
    JSON.stringify(merged.roles) !== JSON.stringify(raw.roles);
  if (changed) {
    globalThis.__accessControlRuntimeState = {
      state: {
        ...raw,
        orgTree: merged.orgTree,
        users: merged.users,
        roles: merged.roles,
        updatedAt: new Date().toISOString(),
      },
    };
  }
  const cur = globalThis.__accessControlRuntimeState.state;
  return {
    orgTree: cloneOrg(cur.orgTree),
    users: cloneUsers(cur.users),
    roles: cloneRoles(cur.roles),
    updatedAt: cur.updatedAt,
  };
}

export function setAccessControlRuntimeState(next: AccessControlState): AccessControlState {
  const merged = mergeAccessControlInvariant({
    orgTree: next.orgTree,
    users: next.users,
    roles: next.roles,
  });
  const normalized: AccessControlState = {
    orgTree: cloneOrg(merged.orgTree),
    users: cloneUsers(merged.users),
    roles: cloneRoles(merged.roles),
    updatedAt: new Date().toISOString(),
  };
  globalThis.__accessControlRuntimeState = { state: normalized };
  return getAccessControlRuntimeState();
}
