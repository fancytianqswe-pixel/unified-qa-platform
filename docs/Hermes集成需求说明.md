# Hermes 集成需求说明

## 1. 文档目标

本需求文档用于指导将开源项目 `hermes-agent` 集成到当前平台，支撑“通过对话完成用户任务，并沉淀为可复用、可定时执行的生产流程”这一核心目标。  
文档面向产品、研发与交付团队，作为后续设计、开发、验收与演进的统一基线。

## 2. 业务目标与范围

### 2.1 业务目标

1. 以自然语言对话作为统一入口，降低任务配置门槛。  
2. 支持 AI 按“理解 -> 计划 -> 执行 -> 反思”闭环完成目标任务。  
3. 支持数据接入类任务：用户提供数据库、表、规则后，AI 自动完成配置与连通性测试。  
4. 支持规则质检类任务：对数据库内数据按业务规则执行校验并输出结果。  
5. 支持将用户认可的任务过程固化为 Skills，并可配置定时任务自动执行。

### 2.2 首期范围（MVP）

- 对话触发数据库接入流程。  
- 数据源配置与连通性探测。  
- 规则质检执行与结果反馈。  
- 任务过程沉淀为 Skill。  
- 基于 Skill 的定时调度执行（按 Cron/间隔）。

### 2.3 非目标（本期不做）

- 完整企业级审批流。  
- 复杂 DAG 编排引擎。  
- 全量多租户权限体系与合规审计平台。  
- 全量指标平台与告警中心深度集成。

## 3. Hermes 能力现状映射

基于 `hermes-agent-main` 仓库调研，现有能力与目标映射如下：

1. **对话驱动执行**：具备。核心会话循环在 `hermes-agent-main/run_agent.py`。  
2. **工具调用机制**：具备。工具注册与调用在 `hermes-agent-main/tools/registry.py`、`hermes-agent-main/model_tools.py`。  
3. **记忆能力**：具备。记忆工具与插件在 `hermes-agent-main/tools/memory_tool.py`、`hermes-agent-main/plugins/memory/`。  
4. **技能沉淀能力**：具备。技能浏览与管理在 `hermes-agent-main/tools/skills_tool.py`、`hermes-agent-main/tools/skill_manager_tool.py`。  
5. **定时任务能力**：具备。任务定义与调度在 `hermes-agent-main/cron/jobs.py`、`hermes-agent-main/cron/scheduler.py`。  
6. **会话持久化检索**：具备。会话数据库在 `hermes-agent-main/hermes_state.py`。  
7. **多入口运行模式**：具备 CLI / Web / Gateway / ACP 入口，便于后续接入不同终端。

## 4. 集成总体方案

### 4.1 方案原则

- 复用 Hermes 现有 Agent Loop 与工具框架，不重复造轮子。  
- 以“新增工具 + 新增 Toolset + Skill 模板化”方式做最小侵入式扩展。  
- 优先打通端到端闭环（可跑通），再逐步生产化增强。

### 4.2 目标架构

1. 前端对话层：发起任务目标与参数。  
2. Hermes Agent 层：进行意图理解、步骤规划、工具调用决策。  
3. 数据治理工具层：新增数据库配置、连通性、规则质检工具。  
4. 任务沉淀层：将成功流程固化为 Skill。  
5. 调度执行层：基于 Cron 定时调用 Skill。  
6. 结果反馈层：返回执行结果、诊断信息与可读报告摘要。

## 5. 功能需求

### 5.1 对话任务编排

1. 用户输入任务目标（示例：“帮我检查订单表手机号字段是否满足 18 位规则”）。  
2. Agent 自动识别任务类型（数据接入 / 连通性测试 / 规则质检 / 定时任务）。  
3. Agent 生成可执行步骤并向用户确认关键参数缺失项。  
4. Agent 调用工具执行任务，失败时给出可操作诊断与重试建议。  
5. 任务完成后询问用户是否固化为 Skill。

### 5.2 数据源配置与连通性测试

1. 支持配置数据源（数据库类型、地址、端口、**库名 + 表名**、账号、密钥引用）；接入粒度须到**表**，不能只配置到库。  
2. 支持连通性测试（如 `SELECT 1`、权限检查、网络延迟）。  
3. 输出标准化结果：`success`、`error_code`、`message`、`latency_ms`、`diagnostics`。  
4. 密钥不明文展示，敏感信息默认脱敏。

### 5.3 规则质检

1. 支持用户以自然语言描述规则。  
2. 支持规则结构化表达（字段、约束、阈值、异常定义）。  
3. 支持批量校验并输出：总量、异常量、异常率、样例明细。  
4. 结果可保存为任务报告并支持后续追踪。

### 5.4 Skills 固化

1. 用户确认后，将任务流程固化为 Skill。  
2. Skill 至少包含：任务描述、输入参数模板、执行步骤、输出格式。  
3. 支持后续在对话中直接调用该 Skill。  
4. 支持 Skill 版本更新与回滚（后续阶段增强）。

### 5.5 定时任务

1. 支持基于 Skill 配置调度规则（Cron/间隔）。  
2. 支持启停、下次执行时间预览、最近执行状态查看。  
3. 执行失败时保留错误上下文，支持人工重跑。  
4. 定时结果可按渠道分发（本地日志、消息平台等）。

## 6. 非功能需求

1. **安全性**：凭据引用化存储，日志脱敏，最小权限访问。  
2. **可靠性**：任务执行可重试，异常有可追踪日志。  
3. **可维护性**：工具职责清晰，输入输出 JSON 契约稳定。  
4. **可扩展性**：后续可新增更多数据源与质检规则模板。  
5. **可观测性**：至少具备任务级状态、耗时、错误信息统计能力。

## 7. 代码实现逻辑梳理

### 7.1 Hermes 现有主链路（复用）

1. 用户输入进入 `AIAgent.run_conversation()`（`hermes-agent-main/run_agent.py`）。  
2. Agent 组装系统提示词与上下文（含 memory/skills）。  
3. 模型返回工具调用意图后，由 `model_tools.handle_function_call()` 分发。  
4. 工具通过 `tools/registry.py` 注册与执行。  
5. 执行结果回流到会话，必要时触发反思与技能沉淀。  
6. 会话与消息写入 `hermes_state.py` 以支持检索与追溯。

### 7.2 本项目新增逻辑（MVP）

1. 新增 `db_config_tool`：负责数据源配置增删改查与密钥引用校验。  
2. 新增 `db_connectivity_tool`：负责连通性测试与诊断结果标准化。  
3. 新增 `rule_qa_tool`：负责规则解析、SQL/执行计划生成、质检统计汇总。  
4. 在 `toolsets.py` 新增数据治理 Toolset，将上述工具组合为一个可调用能力包。  
5. 增加 Skill 模板：将“接入 -> 测试 -> 质检 -> 报告”流程沉淀为可复用技能。  
6. 使用 `cron/jobs.py` + `cron/scheduler.py` 对 Skill 配置周期任务，实现自动执行。

### 7.3 失败与回退逻辑

1. 连接失败：返回错误码与诊断建议，支持用户修正参数后重试。  
2. 规则执行失败：保留 SQL 与错误上下文，提示可选修复路径。  
3. 定时任务失败：状态置为 `error`，记录输出并支持人工触发重跑。  
4. Skill 版本问题：保留上一个可用版本，支持回滚（阶段二增强）。

## 8. 与目标的差距及二期增强

1. 当前缺少正式 DAG 编排与多步骤依赖治理。  
2. 任务级审计与权限体系需单独建设。  
3. 指标、告警、链路追踪需纳入统一观测平台。  
4. 多租户隔离与配额控制需平台化实现。  
5. 结果报告模板、审批与发布流需补齐企业治理能力。

## 9. 分阶段实施计划

### 阶段一（2 周，MVP 可跑通）

1. 打通新增 3 个工具与 Toolset。  
2. 打通对话触发“接入 -> 测试 -> 质检”闭环。  
3. 打通 Skill 固化与 Cron 调度执行。  
4. 完成最小验收与演示场景。

### 阶段二（4-6 周，生产化增强）

1. 增加任务级审计、失败重试策略与告警通知。  
2. 增加规则模板库与结果报告模板。  
3. 增加权限控制与操作留痕。  
4. 完成可观测性与运维面板集成。

## 10. 验收标准

1. 用户可仅通过对话完成数据源接入与连通性测试。  
2. 用户可通过自然语言下发至少 1 条规则并完成质检。  
3. 任务结果可追溯（含输入、过程、输出、错误信息）。  
4. 用户可将流程一键固化为 Skill，并在新会话复用。  
5. 用户可基于 Skill 配置定时任务并看到执行结果。  
6. 关键失败场景有明确错误提示与可执行修复建议。

## 11. 风险与约束

1. 数据库网络与权限环境差异可能导致连通性结果不一致。  
2. 自然语言规则歧义可能影响质检准确率，需二次确认机制。  
3. 高并发定时任务下资源隔离与稳定性需压测验证。  
4. 涉及生产数据时必须先完成脱敏与访问控制策略。

## 12. 术语说明

- **Skill**：可复用的任务能力单元，包含输入模板、执行步骤与输出定义。  
- **Toolset**：按场景组合的一组可调用工具集合。  
- **Cron 任务**：按时间表达式定时触发的自动执行任务。  
- **规则质检**：基于业务约束对数据进行自动校验并输出异常结果。

## 13. 现有功能构成（基于当前代码）

### 13.1 页面入口与路由骨架

1. 统一仪表盘布局入口为 `frontend/src/app/(dashboard)/layout.tsx`，由 `DashboardShell` 承载左侧导航与右侧主内容。  
2. 对话入口页面为 `frontend/src/app/(dashboard)/new-task/page.tsx`，渲染 `NewTaskChat`。  
3. 技能中心页面为 `frontend/src/app/(dashboard)/skills-center/page.tsx`，详情页为 `frontend/src/app/(dashboard)/skills-center/[id]/page.tsx`。  
4. 任务中心页面为 `frontend/src/app/(dashboard)/task-center/page.tsx`。  
5. 数据中心页面为 `frontend/src/app/(dashboard)/data-center/page.tsx`。  
6. 系统设置页面为 `frontend/src/app/(dashboard)/system-settings/page.tsx`，并受 `frontend/middleware.ts` 超级管理员拦截控制。

### 13.2 对话模块当前实现

1. `frontend/src/components/chat/NewTaskChat.tsx` 提供空态 Hero、消息区与输入区布局。  
2. `frontend/src/components/chat/ChatInput.tsx` 已实现富文本输入、技能卡片、附件卡片、语音输入、模型下拉、首条消息会话命名。  
3. `frontend/src/components/chat/MessageList.tsx` 负责多轮消息渲染与 AI 卡片渲染入口（`AdaptiveCardRenderer`）。  
4. 状态中心为 `frontend/src/store/chatStore.ts`，当前 `sendMessage` 仍是本地模拟流程（延时 + 关键词产出 mock cards）。  
5. 会话标题 API 为 `frontend/src/app/api/chat/session-title/route.ts`，已支持按已配置模型调用兼容 OpenAI 的 `/chat/completions` 生成标题。

### 13.3 技能中心当前实现

1. `frontend/src/components/skills/SkillsCenterPage.tsx` 当前基于 `skillMockList` 做搜索与列表展示。  
2. `frontend/src/components/skills/SkillDetailView.tsx` 提供“一键试用、订阅、克隆”，并进入 `SkillEditor` 草稿态。  
3. 技能注册接口 `frontend/src/app/api/skills/register/route.ts` 当前为 Demo 返回（模拟 skillId）。

### 13.4 任务中心当前实现

1. **`/task-center` 侧栏入口保留**；页面为 **`task-center/page.tsx` 占位**（文案提示重构中）。  
2. **已移除**：原 `components/tasks/*`、`/api/tasks/list`、`/api/tasks/schedule`、`lib/taskRuntime.ts`（与旧 mock/内存态任务中心绑定）。后续 Hermes 对接时在重构分支恢复页面与 BFF。

### 13.5 数据中心当前实现

1. `frontend/src/components/data/DataCenterPage.tsx` 组合数据源、模板、安全审计模块。  
2. `frontend/src/components/data/DataSourceManager.tsx` 已有多类型数据源表单（DB/API/文件/Dcoos）与“连通性测试”按钮。  
3. 接口 `frontend/src/app/api/datasource/test/route.ts` 当前为模拟测试结果，尚未连接真实数据库探测链路。

### 13.6 系统设置与模型配置当前实现

1. `frontend/src/components/layout/DashboardShell.tsx` 内置系统管理弹窗，整合用户权限、MCP 服务、审核、审计、模型配置、资源监控、公告。  
2. `frontend/src/components/admin/PlatformConfigSection.tsx` 已支持模型配置增删改、测试连接，并写入 `chatStore.modelConfigs`。  
3. `frontend/src/app/api/models/test/route.ts`（当前项目已存在）用于模型连接测试，是后续 Hermes 模型网关对接的现成落点。

## 14. 与现有代码结合的 Hermes 集成方案

### 14.1 总体策略

1. 前端页面结构保持不变，优先替换“数据来源与执行来源”：从 mock/store 本地模拟替换为 Hermes API。  
2. 采用“前端薄编排 + Hermes 厚执行”的分层：前端负责交互与状态展示，Hermes 负责理解、计划、执行、反思。  
3. 先打通 `new-task + data-center + skills-center + task-center` 主闭环，再扩展到系统治理能力。

### 14.2 分模块接入设计

1. **对话入口（new-task）**  
   - 保留 `ChatInput` 与 `MessageList` 交互形态。  
   - 将 `chatStore.ts` 的 `sendMessage` 从本地生成回复改为调用 Hermes 会话接口（建议新增 `/api/chat/turn` BFF，再转发 Hermes）。  
   - AI 卡片数据由 Hermes 返回结构化 payload，继续复用 `AdaptiveCardRenderer`。

2. **技能中心（skills-center）**  
   - `SkillsCenterPage` 数据源改为 Hermes skill 列表（替换 `skillMockList`）。  
   - `SkillDetailView` 的“订阅/克隆/一键试用”动作改为调用 Hermes skill 工具接口。  
   - `api/skills/register/route.ts` 从 Demo 改为真正调用 Hermes skill 管理能力。  
   - **已实现（本仓库）**：Hermes Gateway **`api_server`** 增加 **`GET /api/skills`**、**`GET /api/skills/detail`**、**`POST /api/skills/register`**（`gateway/platforms/skills_api.py`），与平台 Next BFF **`src/lib/hermes-skills-client.ts`** 对接；配置 **`HERMES_GATEWAY_URL`** 或 **`HERMES_TURN_ENDPOINT`** + **`API_SERVER_KEY`** 即可拉取 `~/.hermes/skills` 目录技能。

3. **数据中心（data-center）**  
   - `DataSourceManager` 保留 UI 结构，`/api/datasource/test` 改为调用 Hermes 新增 `db_connectivity_tool`。  
   - 新增数据源配置落库接口（或密钥引用接口），对应 Hermes `db_config_tool`。  
   - 质检规则执行由 Hermes `rule_qa_tool` 产出结果，前端展示执行摘要与异常样本。

4. **任务中心（task-center）**（当前为占位页，组件与 **`/api/tasks/*`** 已下线）  
   - 恢复页面后：`TaskCenterPage` 从 Hermes 拉取会话任务 + cron 任务列表与状态。  
   - 调度：自然语言转 Cron 走后端解析与保存，写入 Hermes cron job。  
   - 详情：展示 Hermes 执行日志、步骤状态、失败诊断、重跑入口。

5. **系统设置（system-settings / 系统管理弹窗）**  
   - `PlatformConfigSection` 模型配置继续保留，但后续应迁移到服务端安全存储（避免仅存本地持久化）。  
   - 模型测试接口 `api/models/test` 继续使用，并新增“保存到 Hermes 运行时配置”的同步逻辑。  
   - `DashboardShell` 中的系统菜单可作为后续运维与审计能力挂载入口。

### 14.3 后端/BFF 接口建议（结合当前 Next.js 结构）

1. 保留 `frontend/src/app/api/*` 作为前端 BFF 层，统一代理 Hermes 服务。  
2. 建议新增：
   - `frontend/src/app/api/chat/turn/route.ts`：对话单轮执行。  
   - `frontend/src/app/api/skills/list/route.ts`：技能列表。  
   - `frontend/src/app/api/skills/detail/route.ts`：技能详情。  
   - （任务中心重构完成后）**`frontend/src/app/api/tasks/list/route.ts`**：任务列表与状态；**`frontend/src/app/api/tasks/schedule/route.ts`**：创建/启停定时任务（当前仓库已移除上述两路由的落地实现）。  
3. 现有接口改造：
   - `api/skills/register`：改为真实 skill 注册。  
   - `api/datasource/test`：改为真实连通性测试。  
   - `api/chat/session-title`：保留并补充与 Hermes 会话 ID 绑定能力。

## 15. 代码实现逻辑梳理（现状 -> 目标）

### 15.1 对话链路

1. 现状：`ChatInput -> chatStore.sendMessage -> 本地 mock cards -> MessageList`。  
2. 目标：`ChatInput -> /api/chat/turn -> Hermes(AIAgent+tools) -> 结构化响应 -> MessageList/AdaptiveCardRenderer`。  
3. 增强点：每次对话返回 `sessionId/taskId/stepLogs/cards`，用于任务中心联动追踪。

### 15.2 数据接入与连通性链路

1. 现状：`DataSourceManager -> /api/datasource/test(Demo)`。  
2. 目标：`DataSourceManager -> /api/datasource/test -> Hermes db_connectivity_tool -> 真实探测结果`。  
3. 增强点：配置写入统一数据源注册表，并在任务执行时按数据源 ID 引用。

### 15.3 规则质检链路

1. 现状：对话中“数据库质检”主要是前端 mock 计划卡。  
2. 目标：Hermes 解析规则 -> 生成执行计划 -> 调用 `rule_qa_tool` 运行校验 -> 输出异常报告卡。  
3. 增强点：异常样本支持回跳数据中心与报告中心查看明细。

### 15.4 Skill 固化与复用链路

1. 现状：`SkillConfirmCard/register` 为演示注册。  
2. 目标：用户确认后调用 Hermes `skill_manager` 真正落地 skill 文件与元数据。  
3. 增强点：技能中心直接消费 Hermes skill 列表，支持版本、克隆与回滚。

### 15.5 定时任务链路

1. 现状：任务中心占位；原 `ScheduleManager` 与 **`/api/tasks/schedule`** 已移除。  
2. 目标：恢复 UI 后 `ScheduleManager -> /api/tasks/schedule -> Hermes cron/jobs + scheduler`。  
3. 增强点：任务中心显示“下次执行、最近结果、失败重跑、执行耗时趋势”。

## 16. 接口契约草案（MVP）

### 16.1 `POST /api/chat/turn`

**用途**：对话单轮执行（前端统一入口，后端转发 Hermes）。  

请求示例：

```json
{
  "sessionId": "session_xxx",
  "text": "请检查 user_profile 表中 phone 字段是否满足18位手机号规则",
  "blocks": [
    { "type": "skill_card", "name": "数据库质检助手" },
    { "type": "text", "text": "并输出异常样例" }
  ],
  "model": "自动",
  "context": {
    "datasourceId": "ds_prod_01"
  }
}
```

响应示例：

```json
{
  "ok": true,
  "sessionId": "session_xxx",
  "taskId": "task_20260429_001",
  "assistant": {
    "text": "已完成规则校验，发现异常 231 条，请确认是否固化为技能。",
    "cards": [
      {
        "type": "execution_plan",
        "payload": {
          "steps": [
            "识别规则与字段",
            "生成校验SQL",
            "执行并汇总异常",
            "输出报告摘要"
          ]
        }
      },
      {
        "type": "data_preview",
        "payload": {
          "total": 10234,
          "abnormal": 231,
          "abnormalRate": 0.0226
        }
      }
    ]
  },
  "stepLogs": [
    { "step": "plan", "status": "success", "message": "规则已结构化" },
    { "step": "execute", "status": "success", "message": "SQL执行完成" }
  ]
}
```

### 16.2 `POST /api/datasource/test`

**用途**：数据源连通性测试（替换现有 Demo）。  

请求示例：

```json
{
  "name": "生产MySQL",
  "type": "db",
  "host": "10.0.0.12",
  "port": "3306",
  "database": "prod_db",
  "username": "readonly_user",
  "passwordRef": "vault://prod/mysql/readonly"
}
```

响应示例：

```json
{
  "ok": true,
  "status": "success",
  "latencyMs": 132,
  "errorCode": "",
  "message": "connectivity test passed",
  "diagnostics": {
    "network": "ok",
    "auth": "ok",
    "queryProbe": "ok"
  }
}
```

### 16.3 `POST /api/skills/register`

**用途**：将已完成任务固化为 Skill。  

请求示例：

```json
{
  "sessionId": "session_xxx",
  "taskId": "task_20260429_001",
  "name": "手机号规则质检",
  "description": "校验指定表 phone 字段是否满足18位手机号规则",
  "scene": "数据质量巡检",
  "params": [
    { "key": "datasourceId", "required": true },
    { "key": "tableName", "required": true },
    { "key": "fieldName", "required": true }
  ]
}
```

响应示例：

```json
{
  "ok": true,
  "skillId": "skill_phone_rule_check_v1",
  "version": "1.0.0"
}
```

### 16.4 `POST /api/tasks/schedule`（契约草案；当前仓库该 BFF 路由未实现，与任务中心一同待重构接入）

**用途**：基于 Skill 创建或更新调度任务。  

请求示例：

```json
{
  "skillId": "skill_phone_rule_check_v1",
  "natural": "每天凌晨2点执行",
  "cron": "0 2 * * *",
  "enabled": true,
  "input": {
    "datasourceId": "ds_prod_01",
    "tableName": "user_profile",
    "fieldName": "phone"
  }
}
```

响应示例：

```json
{
  "ok": true,
  "jobId": "cron_98765",
  "nextRunAt": "2026-04-30T02:00:00+08:00",
  "status": "scheduled"
}
```

### 16.5 通用错误响应

```json
{
  "ok": false,
  "errorCode": "DATASOURCE_AUTH_FAILED",
  "message": "账号或密钥无效，请检查后重试",
  "hint": "建议先在数据中心执行连通性测试"
}
```

## 17. 核心数据模型建议

### 17.1 Session

- `id`：会话 ID  
- `title`：会话标题  
- `source`：来源（new-task/web/gateway）  
- `createdAt`、`updatedAt`

### 17.2 Task

- `id`：任务 ID  
- `sessionId`：所属会话  
- `type`：任务类型（connectivity_check/rule_qa/skill_publish/schedule_run）  
- `status`：状态（pending/running/success/error/stopped）  
- `input`：输入参数快照  
- `output`：输出结果快照  
- `error`：错误信息  
- `startedAt`、`endedAt`

### 17.3 Skill

- `id`：技能 ID  
- `name`、`description`、`scene`  
- `version`：版本号  
- `definition`：流程定义（可映射 Hermes skill 文件）  
- `createdBy`、`createdAt`

### 17.4 ScheduleJob

- `id`：调度任务 ID  
- `skillId`：关联 Skill  
- `cron`：Cron 表达式  
- `enabled`：启停状态  
- `nextRunAt`：下次执行时间  
- `lastRunStatus`：最近执行状态

## 18. 里程碑交付物（与研发任务绑定）

### 18.1 M1（第 1 周）

1. 打通 `api/chat/turn` 与 Hermes 会话单轮调用。  
2. `chatStore.sendMessage` 完成从 mock 到真实接口切换。  
3. 对话消息中支持展示真实 `stepLogs` 与执行卡片。

### 18.2 M2（第 2 周）

1. `api/datasource/test` 对接真实连通性测试。  
2. `api/skills/register` 对接真实 Skill 固化。  
3. 技能中心由 mock 数据切换为后端数据源。

### 18.3 M3（第 3-4 周）

1. `api/tasks/schedule` 与 Hermes cron 调度打通。  
2. 任务中心展示真实任务与执行状态。  
3. 完成失败重跑、异常提示、最小审计字段落库。

## 19. Hermes 事件契约与前端适配（新增）

### 19.1 统一事件契约

1. BFF 对 Hermes 原始事件做归一化，统一输出：`meta`、`text.delta`、`reasoning.delta`、`tool.started`、`tool.completed`、`step`、`turn.completed`、`turn.failed`。  
2. 统一扩展字段：`seq`（时序）、`source`（`hermes`/`model-direct`/`bff`）、`traceId`（追踪）、`retryableError`（可重试标识）。  
3. 前端仅消费统一事件，不直接耦合 `message.delta`、`run.completed`、`response.output_text.delta` 等上游差异事件名。

### 19.2 前端适配策略

1. `frontend/src/store/chatOrchestrator.ts` 作为协议适配层，解析 SSE 并转成统一事件对象。  
2. `frontend/src/store/chatStore.ts` 作为状态层，按统一事件更新消息、过程日志、状态机与可观测信息。  
3. `frontend/src/components/chat/MessageList.tsx` 只做渲染，不感知 Hermes 协议分歧，确保展示稳定。

### 19.3 降级与容错

1. Hermes 流可用时优先透传 Hermes 过程事件。  
2. Hermes 流不可用且有可用模型配置时，自动切换直连模型并保持同一事件协议返回。  
3. 统一失败事件 `turn.failed`，要求返回可读 `message` 与 `retryableError`，前端可直接触发 `retryLatestTurn`。

