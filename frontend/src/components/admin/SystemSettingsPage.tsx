import { UserPermissionSection } from "@/components/admin/UserPermissionSection";
import { MarketSection } from "@/components/admin/MarketSection";
import { PlatformConfigSection } from "@/components/admin/PlatformConfigSection";

/**
 * SystemSettingsPage 组件/函数。
 */
export function SystemSettingsPage() {
  return (
    <main className="skill-shell">
      <section className="skill-header">
        <h1>系统设置（超级管理员）</h1>
        <p>包含用户权限、组件与市场占位、模型与平台配置。</p>
      </section>
      <UserPermissionSection />
      <MarketSection />
      <PlatformConfigSection />
    </main>
  );
}

