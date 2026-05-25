import { ReactNode } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";

type CellProps = { children: ReactNode; className?: string };
type RowProps = { children: ReactNode; className?: string };
type SectionProps = { children: ReactNode };

/**
 * Table 容器组件，统一表格外观。
 */
export function Table({ children }: SectionProps) {
  return <table className="w-full border-collapse">{children}</table>;
}

/**
 * TableHead 封装 thead。
 */
export function TableHead({ children }: SectionProps) {
  return <thead>{children}</thead>;
}

/**
 * TableBody 封装 tbody。
 */
export function TableBody({ children }: SectionProps) {
  return <tbody>{children}</tbody>;
}

/**
 * TableRow 统一行样式。
 */
export function TableRow({ children, className = "" }: RowProps) {
  return (
    <tr
      className={`border-b border-gray-50 transition-colors hover:bg-gray-50/50 dark:border-slate-800 dark:hover:bg-slate-800/40 ${className}`}
    >
      {children}
    </tr>
  );
}

/**
 * TableHeaderCell 统一表头样式。
 */
export function TableHeaderCell({ children, className = "" }: CellProps) {
  return (
    <th
      className={`bg-transparent px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 ${className}`}
    >
      {children}
    </th>
  );
}

/**
 * TableCell 统一单元格样式。
 */
export function TableCell({ children, className = "" }: CellProps) {
  return <td className={`px-4 py-4 text-sm text-gray-700 dark:text-slate-200 ${className}`}>{children}</td>;
}

/**
 * StatusBadge 根据状态渲染颜色。
 */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-green-100 text-green-700",
    Succeeded: "bg-green-100 text-green-700",
    成功: "bg-green-100 text-green-700",
    通过: "bg-green-100 text-green-700",
    健康: "bg-green-100 text-green-700",
    running: "bg-blue-100 text-blue-700",
    执行中: "bg-blue-100 text-blue-700",
    进行中: "bg-blue-100 text-blue-700",
    "In progress": "bg-blue-100 text-blue-700",
    待审核: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
    失败: "bg-red-100 text-red-700",
    不通过: "bg-red-100 text-red-700",
    告警: "bg-red-100 text-red-700",
    stopped: "bg-gray-100 text-gray-700",
    已停止: "bg-gray-100 text-gray-700",
    未执行: "bg-gray-100 text-gray-600",
    "Not run": "bg-gray-100 text-gray-600",
    启用: "bg-emerald-100 text-emerald-800",
    Enabled: "bg-emerald-100 text-emerald-800",
    禁用: "bg-gray-100 text-gray-600",
    Disabled: "bg-gray-100 text-gray-600",
    使用: "bg-emerald-100 text-emerald-800",
    중지: "bg-gray-100 text-gray-600",
    Réussi: "bg-green-100 text-green-700",
    Échec: "bg-red-100 text-red-700",
    "En cours": "bg-blue-100 text-blue-700",
    "Jamais exécuté": "bg-gray-100 text-gray-600",
    Activé: "bg-emerald-100 text-emerald-800",
    Désactivé: "bg-gray-100 text-gray-600",
    Erfolg: "bg-green-100 text-green-700",
    Fehler: "bg-red-100 text-red-700",
    Läuft: "bg-blue-100 text-blue-700",
    "Noch nicht": "bg-gray-100 text-gray-600",
    Aktiv: "bg-emerald-100 text-emerald-800",
    Inaktiv: "bg-gray-100 text-gray-600",
  };
  const cls = map[status] ?? "bg-gray-100 text-gray-700";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

/**
 * ActionIconButton 图标操作按钮（带原生 tooltip）。
 */
export function ActionIconButton({
  title,
  onClick,
  variant = "view",
}: {
  title: string;
  onClick?: () => void;
  variant?: "view" | "edit" | "delete";
}) {
  const Icon = variant === "edit" ? Pencil : variant === "delete" ? Trash2 : Eye;
  const variantCls =
    variant === "delete"
      ? "bg-gray-100 text-red-600 hover:bg-red-50 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"
      : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-full p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:focus-visible:outline-slate-500 ${variantCls}`}
    >
      <Icon className="size-4" />
    </button>
  );
}

