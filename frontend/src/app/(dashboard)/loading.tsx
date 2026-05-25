import { RouteLoading } from "@/components/layout/RouteLoading";

/**
 * 仪表盘内路由过渡：嵌在 `DashboardShell` 的 `<main>` 内，不再包一层 `<main>`。
 */
export default function DashboardLoading() {
  return <RouteLoading variant="dashboard" />;
}

