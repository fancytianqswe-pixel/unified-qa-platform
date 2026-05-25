import type { DatasourceDraftUiState } from "@/components/chat/types";
import type { DataSourceRecord } from "@/components/data/types";

/** 草稿卡连接指纹：八项变更时丢弃已保存的探测/字段进度 */
export function datasourceDraftFingerprint(record: DataSourceRecord): string {
  const c = record.config;
  return [
    record.name,
    c.dbKind ?? "",
    c.host ?? "",
    c.port ?? "",
    c.database ?? "",
    c.table ?? "",
    c.username ?? "",
  ].join("|");
}

export function resolveDatasourceDraftUi(
  record: DataSourceRecord,
  saved?: DatasourceDraftUiState | null,
): DatasourceDraftUiState | null {
  if (!saved) return null;
  const fp = datasourceDraftFingerprint(record);
  if (saved.configFingerprint !== fp) return null;
  return saved;
}
