---
name: 数据源配置助手
description: 系统内置：对话收集八项数据库参数；输出 hermes-datasource 后由草稿卡片完成连通性、字段、样例与保存（localStorage）。直连模型下可选用 BFF 注册的探测类 function tools。
version: "1.0.0"
author: 平台
tags:
  - 通用工具
---

# 数据源配置助手

本技能为**平台系统内置**，与新任务中「配置数据源」快捷入口及「技能」面板选用时行为一致：开启数据源配置向导后，由模型按约定引导用户补齐字段，并在适当时机输出 `hermes-datasource` 代码块供前端解析为 **数据源草稿卡片**。

## 适用场景

- 首次接入 MySQL / PostgreSQL / SQL Server / Oracle / SQLite 等业务库表。
- 需要同时确认**库名与表名**（不能只接库不接表）。
- 希望在**对话 + 卡片**中完成连通性检测、（MySQL）字段勾选、样例预览与保存到「数据中心」（与数据中心弹窗同源 **localStorage**，非服务端多租户库）。

## 对话内步骤（模型）

1. 用简洁、专业、友好的中文引导；每次优先追问**当前最缺**的信息。
2. 允许用户一条消息提供多项信息，模型应识别并复述已确认项。
3. 信息未齐备时**不要**输出机器可读块。
4. 当八项字段齐备且用户明确同意保存时，在回复**末尾**输出**一个**机器可读块（**禁止仅用 Markdown 表格收束**）：**优先** `hermes-datasource`（JSON）；也可使用 `yaml` 书写 `datasource:` 扁平八项，或 `hermes_datasources:` 下列表**首条**（`type: mysql` 可与 `dbKind` 等价），前端按 **hermes-datasource → fenced `json`（八项对象）→ fenced `yaml`（先 `datasource:` 再 `hermes_datasources:`）** 顺序解析为**同一张草稿卡片**。须明确告知：只有用户在卡片内点击「保存到数据中心」后，记录才会进入数据中心列表（浏览器 **`datacenter.datasources.v1`**）。
5. **直连模型**且 BFF 判定为数据源向导会话时，服务端会向模型注入 OpenAI 风格的 **function tools**（名称含 `datasource_test_connection`、`datasource_list_columns`、`datasource_preview_sample`），与 `/api/datasource/test`、`/columns`、`/preview` 能力一致，可在八项齐备前用于探活或看列；**Hermes 流式路径**是否转发 tools 取决于网关，未保证。最终仍应输出 `hermes-datasource`（或兼容 `yaml`）以生成草稿卡片（用户放弃保存除外）。
6. **用户说「测连接」「测试连接」时**：不要切换到其它技能在 Agent 里跑 Python/脚本测库；应引导先产出可解析块出现**草稿卡**，再点卡片「连通性检测」或使用数据中心弹窗。

## 对话里禁止事项（避免「慢」与误报）

- **禁止**声称「已保存至数据中心」——在用户完成草稿卡片内的「保存」前，列表不会出现新行。**禁止**把在容器内 `~/datasources/*.yaml`、`/root`、`/opt/data`、`/opt/data/home`、任意 `hermes_datasources:` **宿主文件**描述成「已同步到数据中心」；二者存储位置不同。
- **禁止**教用户粘贴自创的 `localStorage.setItem` 脚本。可靠路径：**草稿卡片**或**数据中心弹窗**保存。
- **禁止**用 Python/pymysql、shell、bash、代码解释器等在 **Agent 宿主环境**里自行连接用户数据库。该方式**不是**本产品的连通性实现，宿主常缺驱动（如 pymysql），会反复失败、耗时数十秒；用户看到「运行中 20s+」多为模型在跑这类无关步骤。
- **正确路径**：与数据中心相同——用户侧 `POST /api/datasource/test`（草稿卡片「连通性检测」或数据中心弹窗按钮）；或（直连模型且上游支持 tools 时）调用 `datasource_test_connection`。**慢不是因为没做 MCP**，而是因为走了**错误的执行形态**。

## 数据中心与草稿流程（参考）

详见 [`references/datacenter-datasource-flow.md`](references/datacenter-datasource-flow.md)。

## 卡片内步骤（前端 `DatasourceDraftCard`，与 UI 一致）

草稿卡片挂载后**会自动执行一次连通性检测**；MySQL 且检测通过后**会自动拉取字段列表并默认全选**。用户仍可手动重复「连通性检测」「更新字段」「获取数据」。整体顺序为：

1. **连通性检测** — `POST /api/datasource/test`
2. **更新字段并勾选**（**仅 MySQL** 全功能；非 MySQL 时卡片内黄条说明字段/样例能力受限，仍可测通后保存）— `POST /api/datasource/columns`
3. **获取样例数据**（最多 5 行；请求可携带当前勾选列 `selectedFields`）— `POST /api/datasource/preview`
4. **保存到数据中心** — 前端 `appendDataSourceRecord` + 派发 `datacenter-datasources-changed`，键 `datacenter.datasources.v1`

## 字段说明

| 字段 | 说明 |
|------|------|
| name | 数据源显示名称 |
| dbKind | mysql / postgresql / sqlserver / oracle / sqlite |
| host | 主机域名或 IP |
| port | 端口（字符串，如 `3306`） |
| database | 数据库名 |
| table | 数据表名 |
| username / password | 账号与密码 |

## 安全提示

密码仅用于本机浏览器内配置与探测；探测经 Next Route Handler，部署时应使用 **HTTPS**、内网或鉴权边界；请勿在公网环境明文传播。

## MCP（Hermes / Cursor）可选：独立 stdio 进程

仓库现提供 **独立 stdio MCP 包**：`mcp-servers/datasource-mcp/`（构建后 `dist/index.js`）。工具通过 HTTP 调用本站 **Next `/api/datasource/*`**，与草稿卡、数据中心弹窗**同源后端逻辑**。

### 暴露的工具（与直连 BFF function tools 同名，便于模型迁移）

| 工具 | 何时使用 |
|------|-----------|
| `datasource_test_connection` | 八项将齐或已齐，用户希望确认可连；**优先于**在 Agent 里跑 Python/pymysql。 |
| `datasource_list_columns` | **MySQL** 且 test 已通过，需要字段列表以勾选或说明。 |
| `datasource_preview_sample` | MySQL，需要最多 5 行样例；可传 `selectedFields`。 |
| `datasource_save_guidance` | 无参数；复述「保存只能走浏览器草稿卡 / 数据中心」边界（可选）。 |

### 会话内推荐顺序（对话完成「配置 + 测通 + 看字段/数据」）

1. 多轮补齐 **name, dbKind, host, port, database, table, username, password**。  
2. 调用 **`datasource_test_connection`**；失败则根据报错让用户改 host/端口/账号等。  
3.（MySQL）按需 **`datasource_list_columns`**、**`datasource_preview_sample`**。  
4. 在回复**末尾**输出 **`hermes-datasource`** JSON 围栏或兼容 **`yaml`**，提示用户到 **草稿卡** 再点保存；**不要**声称 MCP 已写入数据中心列表。

### 与内置 function tools 的关系

- **直连模型**且未配 Hermes MCP 时：BFF 仍可能注入同名 **function tools**（见上文「直连模型」段），语义一致。  
- **Hermes 已注册本 MCP**：模型应**优先**使用 MCP 工具完成探活/预览，避免加载无关「数据库诊断」技能在容器内跑长脚本。

更多注册与导出合并说明：**`docs/Hermes数据源MCP.md`**、**`references/hermes-datasource-mcp.md`**。

## 与「真 MCP」的区别（实现边界）

**默认内置路径**仍是 **Next `/api/datasource/*`** 与（直连下）**BFF function tools**——不强制起独立进程。**可选**路径为上述 **stdio MCP**：由运维在 Hermes/Cursor 注册；平台「系统管理 → MCP 服务」导出 JSON 时，若配置了 `DATASOURCE_MCP_CLI_PATH`，可**自动合并**该 stdio 项与界面中已启用的自定义 MCP（见 `.env.example`）。

## 触发示例

> 请使用【数据源配置助手】协助我配置一个 MySQL 数据源：库在 10.0.0.12:3306，库名 orders，表 order_line，只读账号。

## 用技能创建助手修订本 SKILL（验收）

仓库内 **`frontend/src/components/skills/datasource-wizard-builtin-md.ts`** 与本文 **`platform-skills/datasource-wizard-skill/SKILL.md`** 应保持语义一致（内置详情由 BFF 注入 TS 常量；磁盘副本供 Hermes `external_dirs`）。若需按「技能创建助手」规范大改结构，可在**新任务**中挂载 **技能创建助手**，把当前约束与卡片四步流程作为用户消息让其生成修订稿，再**人工合并**回上述两路径并走一轮联调验收。
