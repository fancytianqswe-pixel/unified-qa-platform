"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { permButtonLabel } from "@/i18n/permission-display";
import { useSessionAccess } from "@/components/layout/SessionAccessContext";
import { ROOT_PLATFORM_ORG_ID } from "@/lib/access-control-constants";
import { canUsePageButton } from "@/lib/session-access";
import { SINGLE_SUPER_ADMIN_DEPLOYMENT, SUPER_ADMIN_USER_ID } from "@/lib/platform-auth";

type Mode = "user" | "role";
type AppRole = "超级管理员" | "普通用户" | string;

type OrgNode = {
  id: string;
  name: string;
  children: OrgNode[];
};

type UserRow = {
  id: string;
  name: string;
  account: string;
  role: AppRole;
  orgId: string;
  /** 仅本次写库请求携带，服务端不落库、GET 不回传 */
  __plainPassword?: string;
};

type RoleRow = {
  id: string;
  name: AppRole;
  pages: string[];
  buttonPermissions: Record<string, string[]>;
};

type PermissionNode = {
  key: string;
  /** i18n 文案键；权限落库仍用 `key` 与按钮 canonical 中文 */
  labelKey: string;
  buttons?: string[];
  children?: PermissionNode[];
};

const MAX_LEVEL = 5;
const permissionTree: PermissionNode[] = [
  { key: "menu-new-task", labelKey: "nav.newTask", buttons: ["发送", "上传附件", "技能", "模型选择", "语音输入"] },
  {
    key: "menu-skills-center",
    labelKey: "nav.skillsCenter",
    children: [
      {
        key: "menu-skills-center-list",
        labelKey: "admin.perm.skillsList",
        buttons: ["上传技能包", "新建技能", "市场与我的", "搜索与筛选"],
      },
      {
        key: "menu-skills-center-detail",
        labelKey: "admin.perm.skillsDetail",
        buttons: ["订阅管理", "克隆与定制", "下载文档", "文档预览", "文档源码"],
      },
    ],
  },
  { key: "menu-task-center", labelKey: "nav.taskCenter", buttons: ["查看详情", "重跑", "停止", "查看结果查询明细", "查看报告中心"] },
  { key: "menu-data-center", labelKey: "nav.dataCenter", buttons: ["新增数据源", "更新字段", "获取数据", "保存字段", "编辑", "删除"] },
  {
    key: "menu-system",
    labelKey: "admin.perm.system",
    children: [
      {
        key: "sys-general",
        labelKey: "system.menu.general",
        buttons: [],
      },
      {
        key: "sys-user-permission",
        labelKey: "admin.perm.userPermission",
        children: [
          {
            key: "sys-user-permission-user",
            labelKey: "admin.perm.usersPage",
            buttons: ["新增组织", "删除组织", "新增用户", "删除用户"],
          },
          {
            key: "sys-user-permission-role",
            labelKey: "admin.perm.rolesPage",
            buttons: ["新增角色", "保存", "配置按钮"],
          },
        ],
      },
      {
        key: "sys-mcp",
        labelKey: "admin.perm.mcp",
        buttons: ["添加", "编辑", "删除", "启用停用", "导出JSON", "测试连接", "内置开关"],
      },
      { key: "sys-model", labelKey: "admin.perm.models", buttons: ["新增模型", "测试连接", "保存配置", "编辑", "删除"] },
    ],
  },
];

function getLeafNodes(nodes: PermissionNode[]): PermissionNode[] {
  return nodes.flatMap((node) => (node.children?.length ? getLeafNodes(node.children) : [node]));
}

function getDescendantLeafKeys(node: PermissionNode): string[] {
  if (!node.children?.length) return [node.key];
  return getLeafNodes(node.children).map((leaf) => leaf.key);
}

/** 菜单树节点相对当前角色：无子页勾选 / 部分子叶 / 全部子叶 */
type MenuCheckState = "none" | "partial" | "all";

function getMenuNodeCheckState(role: RoleRow | null, node: PermissionNode): MenuCheckState {
  if (!role) return "none";
  const keys = getDescendantLeafKeys(node);
  if (!keys.length) return "none";
  const count = keys.filter((k) => role.pages.includes(k)).length;
  if (count === 0) return "none";
  if (count === keys.length) return "all";
  return "partial";
}

function PermissionTreeCheckbox({
  state,
  disabled,
  onChange,
}: {
  state: MenuCheckState;
  disabled?: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.indeterminate = state === "partial";
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        onChange();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const topMenus = permissionTree;
const allLeafNodes = getLeafNodes(permissionTree);
const leafByKey = Object.fromEntries(allLeafNodes.map((leaf) => [leaf.key, leaf]));
const allLeafKeys = allLeafNodes.map((leaf) => leaf.key);
const allButtonPermissions = Object.fromEntries(allLeafNodes.map((leaf) => [leaf.key, [...(leaf.buttons ?? [])]]));

const defaultOrgTree: OrgNode[] = [
  {
    id: ROOT_PLATFORM_ORG_ID,
    name: "平台",
    children: [],
  },
];

const defaultUsers: UserRow[] = [
  { id: SUPER_ADMIN_USER_ID, name: "超级管理员", account: "admin", role: "超级管理员", orgId: ROOT_PLATFORM_ORG_ID },
];

const defaultRoles: RoleRow[] = [
  { id: "role-super", name: "超级管理员", pages: [...allLeafKeys], buttonPermissions: { ...allButtonPermissions } },
  {
    id: "role-normal",
    name: "普通用户",
    pages: ["menu-new-task", "menu-task-center"],
    buttonPermissions: {
      "menu-new-task": ["发送", "技能"],
      "menu-task-center": ["查看详情"],
    },
  },
];

function walkTree(nodes: OrgNode[], level: number, visit: (node: OrgNode, level: number) => void) {
  nodes.forEach((node) => {
    visit(node, level);
    walkTree(node.children, level + 1, visit);
  });
}

function getNodeLevel(nodes: OrgNode[], targetId: string): number | null {
  let found: number | null = null;
  walkTree(nodes, 1, (node, level) => {
    if (node.id === targetId) found = level;
  });
  return found;
}

function isDescendant(nodes: OrgNode[], ancestorId: string, targetId: string): boolean {
  let ancestor: OrgNode | null = null;
  walkTree(nodes, 1, (node) => {
    if (node.id === ancestorId) ancestor = node;
  });
  if (!ancestor) return false;
  let ok = false;
  walkTree([ancestor], 1, (node) => {
    if (node.id === targetId) ok = true;
  });
  return ok;
}

function removeNode(nodes: OrgNode[], nodeId: string): { next: OrgNode[]; removed: OrgNode | null } {
  let removed: OrgNode | null = null;
  function dfs(list: OrgNode[]): OrgNode[] {
    return list
      .map((node) => {
        if (node.id === nodeId) {
          removed = { ...node };
          return null;
        }
        return { ...node, children: dfs(node.children) };
      })
      .filter((x): x is OrgNode => !!x);
  }
  return { next: dfs(nodes), removed };
}

function insertAsChild(nodes: OrgNode[], parentId: string, child: OrgNode): OrgNode[] {
  function dfs(list: OrgNode[]): OrgNode[] {
    return list.map((node) => {
      if (node.id === parentId) {
        return { ...node, children: [...node.children, child] };
      }
      return { ...node, children: dfs(node.children) };
    });
  }
  return dfs(nodes);
}

/**
 * UserPermissionSection 组件/函数。
 */
export function UserPermissionSection() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("user");
  const [orgTree, setOrgTree] = useState<OrgNode[]>(defaultOrgTree);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(ROOT_PLATFORM_ORG_ID);
  const [draggingOrgId, setDraggingOrgId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>(defaultUsers);
  const [newOrgName, setNewOrgName] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserAccount, setNewUserAccount] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [roles, setRoles] = useState<RoleRow[]>(defaultRoles);
  const [newRoleName, setNewRoleName] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("role-super");
  const [selectedTopMenuKey, setSelectedTopMenuKey] = useState<string>(topMenus[0]?.key ?? "");
  const [selectedSecondMenuKey, setSelectedSecondMenuKey] = useState<string>("");
  const [selectedThirdMenuKey, setSelectedThirdMenuKey] = useState<string>("");
  const [roleTip, setRoleTip] = useState("");
  const skipRemoteSaveRef = useRef(true);

  const access = useSessionAccess();
  const showUserTab = !access || access.menuKeys.includes("sys-user-permission-user");
  const showRoleTab = !access || access.menuKeys.includes("sys-user-permission-role");
  const canAddOrg = useMemo(() => canUsePageButton(access, "sys-user-permission-user", "新增组织"), [access]);
  const canDelOrg = useMemo(() => canUsePageButton(access, "sys-user-permission-user", "删除组织"), [access]);
  const canOrgMutate = canAddOrg || canDelOrg;
  const canAddUser = useMemo(() => canUsePageButton(access, "sys-user-permission-user", "新增用户"), [access]);
  const canDelUser = useMemo(() => canUsePageButton(access, "sys-user-permission-user", "删除用户"), [access]);
  const canAddRole = useMemo(() => canUsePageButton(access, "sys-user-permission-role", "新增角色"), [access]);
  const canSaveRolePerm = useMemo(() => canUsePageButton(access, "sys-user-permission-role", "保存"), [access]);
  const canConfigRoleMatrix = useMemo(() => canUsePageButton(access, "sys-user-permission-role", "配置按钮"), [access]);

  useEffect(() => {
    if (mode === "user" && !showUserTab && showRoleTab) setMode("role");
    if (mode === "role" && !showRoleTab && showUserTab) setMode("user");
  }, [mode, showUserTab, showRoleTab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/system/access-control");
        const json = (await res.json()) as {
          ok?: boolean;
          data?: { orgTree: OrgNode[]; users: UserRow[]; roles: RoleRow[] };
        };
        if (cancelled || !json.ok || !json.data) return;
        setOrgTree(json.data.orgTree);
        setUsers(json.data.users);
        setRoles(json.data.roles);
      } finally {
        if (!cancelled) skipRemoteSaveRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pushAccessControlRemote = useCallback(async () => {
    try {
      const res = await fetch("/api/system/access-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgTree, users, roles }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        data?: { orgTree: OrgNode[]; users: UserRow[]; roles: RoleRow[] };
      };
      if (res.ok && json.ok && json.data) {
        setOrgTree(json.data.orgTree);
        setUsers(json.data.users);
        setRoles(json.data.roles);
      }
    } catch {
      // 离线或会话过期时忽略，界面仍保留本地编辑态
    }
  }, [orgTree, users, roles]);

  useEffect(() => {
    if (skipRemoteSaveRef.current) return;
    const timer = setTimeout(() => {
      void pushAccessControlRemote();
    }, 900);
    return () => clearTimeout(timer);
  }, [orgTree, users, roles, pushAccessControlRemote]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null,
    [roles, selectedRoleId],
  );
  const selectedTopMenu = topMenus.find((item) => item.key === selectedTopMenuKey) ?? topMenus[0];
  const secondMenus = selectedTopMenu?.children ?? [];
  const selectedSecondMenu = secondMenus.find((item) => item.key === selectedSecondMenuKey) ?? secondMenus[0];
  const thirdMenus = selectedSecondMenu?.children ?? [];
  const selectedThirdMenu = thirdMenus.find((item) => item.key === selectedThirdMenuKey) ?? thirdMenus[0];
  const activeLeafNode =
    thirdMenus.length > 0 ? selectedThirdMenu : secondMenus.length > 0 ? selectedSecondMenu : selectedTopMenu;
  const activeLeafButtons = activeLeafNode?.buttons ?? [];
  const filteredUsers = users.filter((u) => u.orgId === selectedOrgId);

  useEffect(() => {
    if (!selectedTopMenu) return;
    const firstSecond = selectedTopMenu.children?.[0];
    if (!selectedTopMenu.children?.some((item) => item.key === selectedSecondMenuKey)) {
      setSelectedSecondMenuKey(firstSecond?.key ?? "");
    }
    if (firstSecond?.children?.length) {
      if (!firstSecond.children.some((item) => item.key === selectedThirdMenuKey)) {
        setSelectedThirdMenuKey(firstSecond.children[0]?.key ?? "");
      }
    } else {
      setSelectedThirdMenuKey("");
    }
  }, [selectedTopMenuKey, selectedSecondMenuKey, selectedThirdMenuKey, selectedTopMenu]);

  function addOrgNode() {
    if (!canAddOrg) return;
    const name = newOrgName.trim();
    if (!name || !selectedOrgId) return;
    const parentLevel = getNodeLevel(orgTree, selectedOrgId);
    if (!parentLevel || parentLevel >= MAX_LEVEL) {
      return;
    }
    const node: OrgNode = {
      id: `org-${Date.now()}`,
      name,
      children: [],
    };
    setOrgTree((s) => insertAsChild(s, selectedOrgId, node));
    setNewOrgName("");
  }

  function deleteOrgNode(nodeId: string) {
    if (!canDelOrg) return;
    if (nodeId === ROOT_PLATFORM_ORG_ID) return; // 平台组织为系统默认根组织，不可删除
    const { next, removed } = removeNode(orgTree, nodeId);
    if (!removed) return;
    const removedIds: string[] = [];
    walkTree([removed], 1, (n) => removedIds.push(n.id));
    setUsers((s) => s.filter((u) => !removedIds.includes(u.orgId)));
    setOrgTree(next);
    if (removedIds.includes(selectedOrgId)) {
      setSelectedOrgId(ROOT_PLATFORM_ORG_ID);
    }
  }

  function dropOrgOnTarget(targetId: string) {
    if (!canOrgMutate) return;
    if (!draggingOrgId || draggingOrgId === targetId) return;
    if (draggingOrgId === ROOT_PLATFORM_ORG_ID) return; // 平台根组织固定在最上层
    if (isDescendant(orgTree, draggingOrgId, targetId)) return; // 禁止拖进自己的子树
    const targetLevel = getNodeLevel(orgTree, targetId);
    if (!targetLevel || targetLevel >= MAX_LEVEL) return;
    const { next, removed } = removeNode(orgTree, draggingOrgId);
    if (!removed) return;
    setOrgTree(insertAsChild(next, targetId, removed));
    setDraggingOrgId(null);
  }

  function addUser() {
    if (!canAddUser) return;
    const name = newUserName.trim();
    const account = newUserAccount.trim();
    if (!name || !account || !selectedOrgId) return;
    const plain = newUserPassword.trim() || account;
    setUsers((s) => [
      ...s,
      {
        id: `user-${Date.now()}`,
        name,
        account,
        orgId: selectedOrgId,
        role: "普通用户",
        __plainPassword: plain,
      },
    ]);
    setNewUserName("");
    setNewUserAccount("");
    setNewUserPassword("");
  }

  function removeUser(userId: string) {
    if (!canDelUser) return;
    if (userId === SUPER_ADMIN_USER_ID) return; // 系统默认超级管理员不可删除
    setUsers((s) => s.filter((u) => u.id !== userId));
  }

  function addRole() {
    if (!canAddRole) return;
    const name = newRoleName.trim();
    if (!name) return;
    const id = `role-${Date.now()}`;
    setRoles((s) => [...s, { id, name, pages: [], buttonPermissions: {} }]);
    setSelectedRoleId(id);
    setNewRoleName("");
  }

  function toggleRoleNode(node: PermissionNode) {
    if (!canConfigRoleMatrix) return;
    if (!selectedRole) return;
    setRoles((s) =>
      s.map((r) => {
        if (r.id !== selectedRole.id) return r;
        const leafKeys = getDescendantLeafKeys(node);
        const allChecked = leafKeys.every((key) => r.pages.includes(key));
        const pageSet = new Set(r.pages);
        const nextPermission = { ...r.buttonPermissions };
        if (allChecked) {
          leafKeys.forEach((key) => {
            pageSet.delete(key);
            delete nextPermission[key];
          });
        } else {
          leafKeys.forEach((key) => {
            pageSet.add(key);
            // 仅授予菜单访问：不自动勾选该叶下全部按钮；已配置的按钮集合保持不变
          });
        }
        return {
          ...r,
          pages: Array.from(pageSet),
          buttonPermissions: nextPermission,
        };
      }),
    );
  }

  function toggleRoleButton(pageKey: string, button: string) {
    if (!canConfigRoleMatrix) return;
    if (!selectedRole) return;
    setRoles((s) =>
      s.map((r) => {
        if (r.id !== selectedRole.id) return r;
        const current = r.buttonPermissions[pageKey] ?? [];
        const next = current.includes(button) ? current.filter((x) => x !== button) : [...current, button];
        let nextPages = r.pages;
        if (!r.pages.includes(pageKey)) {
          nextPages = [...r.pages, pageKey];
        }
        const nextPermission = { ...r.buttonPermissions };
        if (next.length === 0) {
          delete nextPermission[pageKey];
        } else {
          nextPermission[pageKey] = next;
        }
        return {
          ...r,
          pages: nextPages,
          buttonPermissions: nextPermission,
        };
      }),
    );
  }

  function selectNode(node: PermissionNode, level: 1 | 2 | 3) {
    if (level === 1) {
      setSelectedTopMenuKey(node.key);
      setSelectedSecondMenuKey(node.children?.[0]?.key ?? "");
      setSelectedThirdMenuKey(node.children?.[0]?.children?.[0]?.key ?? "");
      return;
    }
    if (level === 2) {
      setSelectedSecondMenuKey(node.key);
      setSelectedThirdMenuKey(node.children?.[0]?.key ?? "");
      return;
    }
    setSelectedThirdMenuKey(node.key);
  }

  async function saveRole() {
    if (!canSaveRolePerm) return;
    if (!selectedRole) return;
    await pushAccessControlRemote();
    setRoleTip(t("admin.role.saveTip", { name: selectedRole.name }));
    setTimeout(() => setRoleTip(""), 1200);
  }

  function renderOrgTree(nodes: OrgNode[], level = 1) {
    return nodes.map((node) => (
      <div key={node.id}>
        <div
          className={`mb-2 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition ${
            selectedOrgId === node.id
              ? "border-blue-300 bg-blue-50 text-slate-900 dark:border-blue-700 dark:bg-blue-950/55 dark:text-slate-100"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          }`}
          style={{ marginLeft: `${(level - 1) * 14}px` }}
          draggable={canOrgMutate}
          onDragStart={(e) => {
            if (!canOrgMutate) {
              e.preventDefault();
              return;
            }
            setDraggingOrgId(node.id);
          }}
          onDragOver={(e) => {
            if (canOrgMutate) e.preventDefault();
          }}
          onDrop={() => {
            if (canOrgMutate) dropOrgOnTarget(node.id);
          }}
          onClick={() => setSelectedOrgId(node.id)}
        >
          <GripVertical
            className={`size-4 text-slate-400 ${canOrgMutate ? "cursor-grab" : "cursor-default opacity-40"}`}
          />
          <span className="flex-1">{node.id === ROOT_PLATFORM_ORG_ID ? t("admin.user.orgRootName") : node.name}</span>
          <button
            type="button"
            title={t("admin.user.delOrgTitle")}
            disabled={!canDelOrg}
            className="!rounded-full !bg-slate-100 p-1.5 !text-slate-600 hover:!bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 dark:!bg-slate-700 dark:!text-slate-200 dark:hover:!bg-slate-600"
            onClick={(e) => {
              e.stopPropagation();
              deleteOrgNode(node.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        {node.children.length ? renderOrgTree(node.children, level + 1) : null}
      </div>
    ));
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mt-1 flex items-center gap-6 bg-[#fbfbfb] pb-2 pt-1 dark:bg-slate-950">
        {showUserTab ? (
          <button
            type="button"
            className={`relative !bg-transparent !px-0 !py-0 text-xl leading-none hover:!bg-transparent ${
              mode === "user"
                ? "!text-slate-900 font-semibold dark:!text-slate-100"
                : "!text-slate-400 font-medium dark:!text-slate-500"
            }`}
            onClick={() => setMode("user")}
          >
            {t("admin.user.tabUser")}
          </button>
        ) : null}
        {showRoleTab ? (
          <button
            type="button"
            className={`relative !bg-transparent !px-0 !py-0 text-xl leading-none hover:!bg-transparent ${
              mode === "role"
                ? "!text-slate-900 font-semibold dark:!text-slate-100"
                : "!text-slate-400 font-medium dark:!text-slate-500"
            }`}
            onClick={() => setMode("role")}
          >
            {t("admin.user.tabRole")}
          </button>
        ) : null}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {mode === "user" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("admin.user.orgTitle")}</p>
              </div>
              <div className="mt-3 max-h-[420px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-900/60">
                {renderOrgTree(orgTree)}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  placeholder={t("admin.user.orgPlaceholder")}
                  className="!h-10"
                  value={newOrgName}
                  disabled={!canAddOrg}
                  onChange={(e) => setNewOrgName(e.target.value)}
                />
                <button
                  type="button"
                  disabled={!canAddOrg}
                  className="!h-10 !rounded-xl px-4 py-1.5 text-sm font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={addOrgNode}
                >
                  {t("admin.user.addOrg")}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="panel-title-row">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("admin.user.userListTitle")}</p>
                <span className="text-xs text-slate-500">
                  {t("admin.user.userCount", { count: String(filteredUsers.length) })}
                </span>
              </div>
              {!SINGLE_SUPER_ADMIN_DEPLOYMENT ? (
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                  <input
                    className="!h-10"
                    placeholder={t("admin.user.placeholderName")}
                    value={newUserName}
                    disabled={!canAddUser}
                    onChange={(e) => setNewUserName(e.target.value)}
                  />
                  <input
                    className="!h-10"
                    placeholder={t("admin.user.placeholderAccount")}
                    value={newUserAccount}
                    disabled={!canAddUser}
                    onChange={(e) => setNewUserAccount(e.target.value)}
                  />
                  <input
                    className="!h-10"
                    type="password"
                    placeholder={t("admin.user.placeholderPassword")}
                    autoComplete="new-password"
                    value={newUserPassword}
                    disabled={!canAddUser}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!canAddUser}
                    className="!h-10 !rounded-xl px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={addUser}
                  >
                    {t("admin.user.addUser")}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">{t("admin.user.singleAdminHint")}</p>
              )}

              <div className="table-wrap mt-3">
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[28%]" />
                    <col className="w-auto" />
                    <col className="w-[108px]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {t("admin.user.colName")}
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {t("admin.user.colAccount")}
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {t("admin.user.colRole")}
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {t("admin.user.colAction")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length ? (
                      filteredUsers.map((u) => (
                        <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-4 py-4 text-base text-slate-700 dark:text-slate-200">{u.name}</td>
                          <td className="truncate px-4 py-4 text-base text-slate-700 dark:text-slate-200">{u.account}</td>
                          <td className="truncate px-4 py-4 text-base text-slate-700 dark:text-slate-200">{u.role}</td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end">
                              {u.id === SUPER_ADMIN_USER_ID ? (
                                <span className="text-xs text-slate-400">{t("admin.user.builtin")}</span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canDelUser}
                                  className="whitespace-nowrap !rounded-lg !bg-rose-50 px-3 py-1 text-xs font-medium !text-rose-700 hover:!bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40 dark:!bg-rose-950/50 dark:!text-rose-200 dark:hover:!bg-rose-950/70"
                                  onClick={() => removeUser(u.id)}
                                >
                                  {permButtonLabel("删除", t)}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-4 py-5 text-sm text-slate-400" colSpan={4}>
                          {t("admin.user.emptyUsers")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!SINGLE_SUPER_ADMIN_DEPLOYMENT ? (
                <p className="mt-2 text-xs text-slate-500">
                  {t("admin.user.footerHint")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "role" ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="panel-title-row">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("admin.role.matrixTitle")}</p>
            </div>
            <div className="mt-3 grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(200px,1fr)_minmax(200px,1fr)_auto_auto]">
              <select
                value={selectedRoleId}
                onChange={(e) => {
                  const roleId = e.target.value;
                  setSelectedRoleId(roleId);
                  setSelectedTopMenuKey(topMenus[0]?.key ?? "");
                  setSelectedSecondMenuKey(topMenus[0]?.children?.[0]?.key ?? "");
                  setSelectedThirdMenuKey(topMenus[0]?.children?.[0]?.children?.[0]?.key ?? "");
                }}
                className="max-w-xs"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                className="max-w-xs"
                placeholder={t("admin.role.placeholderNewRole")}
                value={newRoleName}
                disabled={!canAddRole}
                onChange={(e) => setNewRoleName(e.target.value)}
              />
              {!SINGLE_SUPER_ADMIN_DEPLOYMENT ? (
                <button
                  type="button"
                  disabled={!canAddRole}
                  className="w-full !rounded-xl px-3 py-2 text-sm md:w-auto md:whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={addRole}
                >
                  {t("admin.role.addRole")}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canSaveRolePerm}
                className="w-full !rounded-xl px-3 py-2 text-sm md:w-auto md:whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                onClick={saveRole}
              >
                {t("admin.role.save")}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,0.82fr)]">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{t("admin.role.level1")}</p>
                    <div className="mt-2 grid max-h-[360px] gap-1 overflow-y-auto pr-1">
                      {topMenus.map((item) => {
                        const checkState = getMenuNodeCheckState(selectedRole, item);
                        const active = selectedTopMenuKey === item.key;
                        return (
                          <div
                            key={item.key}
                            className={`cursor-pointer rounded-lg border px-2 py-2 text-sm transition ${
                              active ? "border-blue-300 bg-blue-50/80" : "border-transparent hover:bg-slate-50"
                            }`}
                            onClick={() => selectNode(item, 1)}
                          >
                          <div className="flex w-full items-center gap-2 text-slate-700">
                            <PermissionTreeCheckbox
                              state={checkState}
                              disabled={!canConfigRoleMatrix}
                              onChange={() => toggleRoleNode(item)}
                            />
                            <span className="flex-1 truncate">{t(item.labelKey)}</span>
                          </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{t("admin.role.level2")}</p>
                    <div className="mt-2 grid max-h-[360px] gap-1 overflow-y-auto pr-1">
                      {secondMenus.length ? (
                        secondMenus.map((item) => {
                          const checkState = getMenuNodeCheckState(selectedRole, item);
                          const active = selectedSecondMenuKey === item.key;
                          return (
                            <div
                              key={item.key}
                              className={`cursor-pointer rounded-lg border px-2 py-2 text-sm transition ${
                                active ? "border-blue-300 bg-blue-50/80" : "border-transparent hover:bg-slate-50"
                              }`}
                              onClick={() => selectNode(item, 2)}
                            >
                              <div className="flex w-full items-center gap-2 text-slate-700">
                                <PermissionTreeCheckbox
                                  state={checkState}
                                  disabled={!canConfigRoleMatrix}
                                  onChange={() => toggleRoleNode(item)}
                                />
                                <span className="flex-1 truncate">{t(item.labelKey)}</span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="px-1 py-2 text-sm text-slate-400">{t("admin.role.noLevel2")}</p>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{t("admin.role.level3")}</p>
                    <div className="mt-2 grid max-h-[360px] gap-1 overflow-y-auto pr-1">
                      {thirdMenus.length ? (
                        thirdMenus.map((item) => {
                          const checkState = getMenuNodeCheckState(selectedRole, item);
                          const active = selectedThirdMenuKey === item.key;
                          return (
                            <div
                              key={item.key}
                              className={`cursor-pointer rounded-lg border px-2 py-2 text-sm transition ${
                                active ? "border-blue-300 bg-blue-50/80" : "border-transparent hover:bg-slate-50"
                              }`}
                              onClick={() => selectNode(item, 3)}
                            >
                              <div className="flex w-full items-center gap-2 text-slate-700">
                                <PermissionTreeCheckbox
                                  state={checkState}
                                  disabled={!canConfigRoleMatrix}
                                  onChange={() => toggleRoleNode(item)}
                                />
                                <span className="flex-1 truncate">{t(item.labelKey)}</span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="px-1 py-2 text-sm text-slate-400">{t("admin.role.noLevel3")}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-fit rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-700">{t("admin.role.buttonPerms")}</p>
                {activeLeafButtons.length ? (
                  <div className="mt-2 grid gap-2">
                    {activeLeafButtons.map((btn) => (
                      <label key={btn} className="flex w-full items-center justify-start gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!selectedRole?.buttonPermissions[activeLeafNode?.key ?? ""]?.includes(btn)}
                          disabled={!canConfigRoleMatrix}
                          onChange={() => toggleRoleButton(activeLeafNode?.key ?? "", btn)}
                        />
                        <span className="whitespace-nowrap">{permButtonLabel(btn, t)}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">{t("admin.role.noButtons")}</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-col items-end gap-2">
              {access && showRoleTab && !canConfigRoleMatrix ? (
                <p className="max-w-full text-left text-xs text-amber-800 md:text-right">
                  {t("admin.role.matrixReadonly")}
                </p>
              ) : null}
              {roleTip ? <span className="text-sm text-emerald-700">{roleTip}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

