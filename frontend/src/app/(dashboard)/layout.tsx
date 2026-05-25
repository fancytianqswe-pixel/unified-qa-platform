import { DashboardShell } from "@/components/layout/DashboardShell";

type Props = {
  children: React.ReactNode;
};

/**
 * DashboardLayout 统一仪表盘左侧导航与右侧主界面。
 */
export default function DashboardLayout({ children }: Props) {
  return <DashboardShell>{children}</DashboardShell>;
}

