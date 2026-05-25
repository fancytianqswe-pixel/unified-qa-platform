export type DataSourceType = "db" | "api" | "file" | "dcoos";
export type DbKind = "mysql" | "postgresql" | "sqlserver" | "oracle" | "sqlite";

export type DataSourceForm = {
  name: string;
  type: DataSourceType;
  /** DB 引擎类型 */
  dbKind?: DbKind;
  host?: string;
  port?: string;
  database?: string;
  /** DB 类型必填：接入粒度为「库.表」，不能只填库 */
  table?: string;
  username?: string;
  password?: string;
  url?: string;
  method?: string;
  authType?: string;
  rootPath?: string;
  keyPath?: string;
  endpoint?: string;
  appId?: string;
  appSecret?: string;
  /** 字段勾选结果（按表字段名） */
  selectedFields?: string[];
};

export type DataSourceStoredConfig = DataSourceForm;

/** 数据源列表行（本地持久化；包含编辑回填所需配置） */
export type DataSourceRecord = {
  id: string;
  name: string;
  type: DataSourceType;
  /** 连接信息摘要，供表格展示 */
  summary: string;
  createdAt: string;
  config: DataSourceStoredConfig;
};

