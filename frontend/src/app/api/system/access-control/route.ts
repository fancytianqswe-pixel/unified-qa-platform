import { NextResponse } from "next/server";
import {
  AccessControlState,
  getAccessControlRuntimeState,
  mergeAccessControlInvariant,
  sanitizeAccessControlForClient,
  setAccessControlRuntimeState,
  type UserRow,
} from "@/lib/accessControlRuntime";
import { hashPasswordForUser } from "@/lib/password-auth";

function isValidOrgNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { id?: unknown; name?: unknown; children?: unknown };
  if (typeof n.id !== "string" || typeof n.name !== "string") return false;
  if (!Array.isArray(n.children)) return false;
  return n.children.every((child) => isValidOrgNode(child));
}

function isValidPayload(payload: unknown): payload is Pick<AccessControlState, "orgTree" | "users" | "roles"> {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as {
    orgTree?: unknown;
    users?: unknown;
    roles?: unknown;
  };
  if (!Array.isArray(p.orgTree) || !p.orgTree.every((node) => isValidOrgNode(node))) return false;
  if (
    !Array.isArray(p.users) ||
    !p.users.every((row) => {
      if (!row || typeof row !== "object") return false;
      const u = row as {
        id?: unknown;
        name?: unknown;
        account?: unknown;
        role?: unknown;
        orgId?: unknown;
        __plainPassword?: unknown;
        passwordHash?: unknown;
      };
      if ("passwordHash" in u) return false;
      if (u.__plainPassword !== undefined && typeof u.__plainPassword !== "string") return false;
      return (
        typeof u.id === "string" &&
        typeof u.name === "string" &&
        typeof u.account === "string" &&
        typeof u.role === "string" &&
        typeof u.orgId === "string"
      );
    })
  ) {
    return false;
  }
  if (
    !Array.isArray(p.roles) ||
    !p.roles.every((row) => {
      if (!row || typeof row !== "object") return false;
      const r = row as { id?: unknown; name?: unknown; pages?: unknown; buttonPermissions?: unknown };
      if (typeof r.id !== "string" || typeof r.name !== "string") return false;
      if (!Array.isArray(r.pages) || !r.pages.every((x) => typeof x === "string")) return false;
      if (!r.buttonPermissions || typeof r.buttonPermissions !== "object") return false;
      return Object.values(r.buttonPermissions as Record<string, unknown>).every(
        (value) => Array.isArray(value) && value.every((x) => typeof x === "string"),
      );
    })
  ) {
    return false;
  }
  return true;
}

function persistAccessControlPayload(payload: Pick<AccessControlState, "orgTree" | "users" | "roles">): AccessControlState {
  const prev = getAccessControlRuntimeState();
  const usersWithSecrets = mergeUsersWithPasswordPolicy(payload.users, prev);
  const merged = mergeAccessControlInvariant({
    orgTree: payload.orgTree,
    users: usersWithSecrets,
    roles: payload.roles,
  });
  return setAccessControlRuntimeState({
    orgTree: merged.orgTree,
    users: merged.users,
    roles: merged.roles,
    updatedAt: new Date().toISOString(),
  });
}

function mergeUsersWithPasswordPolicy(incoming: unknown[], prev: AccessControlState): UserRow[] {
  if (!Array.isArray(incoming)) return [];
  return incoming.map((row) => {
    const u = row as Record<string, unknown>;
    const id = String(u.id ?? "");
    const base: UserRow = {
      id,
      name: String(u.name ?? ""),
      account: String(u.account ?? ""),
      role: String(u.role ?? ""),
      orgId: String(u.orgId ?? ""),
    };
    const plain =
      typeof u.__plainPassword === "string" && u.__plainPassword.trim() !== "" ? u.__plainPassword.trim() : "";
    const prevUser = prev.users.find((p) => p.id === id);
    if (plain !== "") {
      return { ...base, passwordHash: hashPasswordForUser(plain, id) };
    }
    if (prevUser?.passwordHash) {
      return { ...base, passwordHash: prevUser.passwordHash };
    }
    return { ...base };
  });
}

export async function GET() {
  const endpoint = process.env.HERMES_ACCESS_CONTROL_ENDPOINT?.trim();
  if (!endpoint) {
    return NextResponse.json({ ok: true, data: sanitizeAccessControlForClient(getAccessControlRuntimeState()) });
  }
  try {
    const response = await fetch(endpoint, { method: "GET" });
    if (!response.ok) throw new Error("upstream failed");
    const data = (await response.json()) as unknown;
    const body = data as { ok?: boolean; data?: unknown };
    if (body?.ok && body.data && isValidPayload(body.data)) {
      persistAccessControlPayload(body.data);
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      ok: true,
      data: sanitizeAccessControlForClient(getAccessControlRuntimeState()),
      fallback: true,
    });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json()) as unknown;
  if (!isValidPayload(payload)) {
    return NextResponse.json({ ok: false, message: "无效的权限配置结构" }, { status: 400 });
  }

  const endpoint = process.env.HERMES_ACCESS_CONTROL_ENDPOINT?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const data = (await response.json()) as unknown;
        const body = data as { ok?: boolean; data?: unknown };
        if (body?.ok && body.data && isValidPayload(body.data)) {
          persistAccessControlPayload(body.data);
        }
        return NextResponse.json(data);
      }
    } catch {
      // ignore and fallback
    }
  }

  const saved = persistAccessControlPayload(payload);
  return NextResponse.json({ ok: true, data: sanitizeAccessControlForClient(saved) });
}
