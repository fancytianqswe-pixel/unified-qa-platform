# 数据中心与数据源草稿卡（产品边界）

## 存储位置

- **数据中心「数据源」列表**保存在用户浏览器的 **localStorage**，键名：**`datacenter.datasources.v1`**。
- Agent 容器内路径（如 **`/opt/data`**、**`~/datasources/*.yaml`**）、**`hermes_datasources:` 宿主配置文件** 等 **不会**自动写入上述列表，也 **不应**在对话中描述为「已保存到数据中心」。

## 草稿卡四步（与 UI 一致）

1. **连通性检测**：浏览器请求本站 **`POST /api/datasource/test`**（与数据中心弹窗同源能力）。
2. **更新字段**（MySQL 全量）：**`POST /api/datasource/columns`**。
3. **样例预览**：**`POST /api/datasource/preview`**。
4. **保存到数据中心**：前端 **`appendDataSourceRecord`**，并派发 **`datacenter-datasources-changed`**。

## Hermes MCP（可选）

若网关已注册 **数据源 stdio MCP**（`mcp-servers/datasource-mcp`），模型应用 **`datasource_*`** 工具做测通与预览，再输出可解析块。详见 **`hermes-datasource-mcp.md`** 与 **`docs/Hermes数据源MCP.md`**。

## 模型侧约定（摘要）

- 八项齐备且用户同意保存时，在回复末尾输出 **hermes-datasource** 代码围栏（首选）或兼容 **yaml** 围栏（**`datasource:`** 或 **`hermes_datasources:`** 列表首条），由 BFF/前端解析并挂载 **数据源草稿卡片**。
- **禁止**引导用户在 Agent 内用 Python/pymysql、长脚本链做「产品级」测连；用户应使用 **草稿卡按钮** 或 **数据中心弹窗**。
- **禁止**给出自创 **`localStorage.setItem`** 脚本冒充保存；记录形状必须与 **`DataSourceRecord`**（含 **`id` / `type` / `summary` / `config`**）一致，否则易损坏列表。
