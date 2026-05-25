"use client";

import { McpServicesSection } from "@/components/admin/McpServicesSection";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

/**
 * MarketSection：MCP 组件库入口；「组件与市场」合页占位（审核台等已下线）。
 */
export function MarketSection({ mode = "all" }: { mode?: "all" | "mcp" }) {
  const showMcp = mode === "all" || mode === "mcp";

  return (
    <section className={mode === "mcp" ? "min-w-0 text-slate-900" : "task-card"}>
      {mode === "mcp" ? null : <h3>组件与市场</h3>}

      {showMcp ? (
        mode === "mcp" ? (
          <McpServicesSection />
        ) : (
          <>
            <h4>MCP 组件库</h4>
            <p className="mb-3 text-sm text-slate-500">
              完整自定义 MCP 配置请打开左侧菜单「MCP服务」；此处为组件与市场合页占位。
            </p>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>说明</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell className="text-slate-600">请使用系统管理 → MCP服务 管理落库配置。</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>
        )
      ) : null}
    </section>
  );
}
