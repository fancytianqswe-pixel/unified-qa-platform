"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ClientSessionAccessDto } from "@/lib/session-access";

const SessionAccessContext = createContext<ClientSessionAccessDto | null>(null);

export function SessionAccessProvider({
  value,
  children,
}: {
  value: ClientSessionAccessDto | null;
  children: ReactNode;
}) {
  return <SessionAccessContext.Provider value={value}>{children}</SessionAccessContext.Provider>;
}

/** 未就绪时为 `null`（子组件可按全量展示或自行兜底） */
export function useSessionAccess() {
  return useContext(SessionAccessContext);
}
