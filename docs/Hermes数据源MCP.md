# Hermes / Cursor 接入「数据源 MCP」

目标：使对话中的模型可调用与 **数据中心草稿卡** 同源的能力（测通、MySQL 列、样例），再配合模型输出 **`hermes-datasource` / 兼容 yaml`**，用户在 **统一质检平台前端** 完成保存（`localStorage`）。

## 0. 推荐：Hermes API Server 内置工具（默认开启）

本仓库在 **`hermes-agent/hermes-agent-main/tools/xingyan_datasource_tools.py`** 中注册了与 MCP 包**同名**的四个工具：`datasource_test_connection`、`datasource_list_columns`、`datasource_preview_sample`、`datasource_save_guidance`。它们已并入 **`hermes-api-server`** 工具集（`toolsets.py` 的 `includes`），**网关进程启动后即可被模型调用**，内部通过 HTTP 请求 Next 的 `POST /api/datasource/*`，与 `mcp-servers/datasource-mcp` 行为一致。

- **Base URL**：读取环境变量 **`DATASOURCE_MCP_BASE_URL`** 或 **`XINGYAN_BFF_URL`**，默认 `http://127.0.0.1:3000`。Hermes 跑在 Docker、Next 在宿主机时，请在**运行 Hermes 的环境**中设为 `http://host.docker.internal:3000`（或可达地址）。使用本仓库 **`docker-compose.docker-desktop.yml`** 启动 Gateway 时，已默认注入 **`DATASOURCE_MCP_BASE_URL=http://host.docker.internal:3000`**（可用同名环境变量覆盖）；**`docker-compose.yml`**（`network_mode: host`）默认 **`http://127.0.0.1:3000`**。
- **关闭注册**：设置 **`HERMES_XINGYAN_DATASOURCE_TOOLS=0`**（或 `false`/`off`）。
- **与 stdio MCP 的关系**：Hermes 侧 MCP 工具名一般为 `mcp_<服务名>_<工具名>`，与上述内置名**不冲突**；若仍配置了 stdio `datasource-mcp`，可二选一或并存（模型可能同时看到两套入口，一般保留内置即可）。

若你更希望在 **Cursor** 或其它宿主中仅用 stdio MCP，或 Hermes 版本未包含本补丁，可继续按下文构建独立 MCP 包。

## 1. 构建 MCP 包

在仓库根目录：

```bash
cd mcp-servers/datasource-mcp
npm install
npm run build
```

得到可执行入口：`mcp-servers/datasource-mcp/dist/index.js`（Node ≥ 18）。

## 2. 保证 Next 可达

MCP 进程会向 `DATASOURCE_MCP_BASE_URL`（默认 `http://127.0.0.1:3000`）发 `POST /api/datasource/test|columns|preview`。

- **Next 与 MCP 同机**：可不设环境变量，或 `DATASOURCE_MCP_BASE_URL=http://127.0.0.1:3000`。
- **Hermes 在 Docker、Next 在宿主机**：在 MCP 的 `env` 中设置  
  `DATASOURCE_MCP_BASE_URL=http://host.docker.internal:3000`  
  （Windows/Mac Docker Desktop；Linux 需自行配置可从容器访问宿主机的地址。）

## 3. Hermes 注册（示意）

将 `mcp_servers`（或你方版本等价字段）指向 **node + dist/index.js 绝对路径**，并传入上述 `env`：

```yaml
mcp_servers:
  xingyan-datasource:
    command: "node"
    args:
      - "/绝对路径/mcp-servers/datasource-mcp/dist/index.js"
    env:
      DATASOURCE_MCP_BASE_URL: "http://host.docker.internal:3000"
```

重启 Hermes Gateway 使配置生效。具体键名请以 **`hermes-agent-main`** 内 `config.yaml` / 文档为准。

**与 MinerU 等内置项合并**：见仓库 **`docs/Hermes-mcp_servers.builtin-xingyan.example.yaml`**（含 `docker-compose` 挂载 **`/opt/xingyan-mcp`** 的说明）。

## 4. 与「系统管理 → MCP 服务」导出合并

1. 在 **frontend** 复制 `.env.example` 中与 `DATASOURCE_MCP_*` 相关的项到 `.env.local`。  
2. 设置 **`DATASOURCE_MCP_CLI_PATH`** 为本机（或部署机）上 **`dist/index.js` 的绝对路径**。  
3. 打开 **系统管理 → MCP 服务**，维护好其它已启用的自定义 MCP。  
4. 点击 **导出 JSON**：响应中的 `mcpServers` 会包含 **界面里启用的条目** +（若配置了 `DATASOURCE_MCP_CLI_PATH`）**自动并入的 `xingyan-datasource` stdio 块**；`datasourceMcpMerged: true` 表示本次合并成功。

这样 **手动添加的 MCP** 与 **环境变量并入的数据源 MCP** 可在同一份 JSON 里交给 Hermes / Cursor 使用。

## 5. 与「数据源配置助手」技能配合（模型侧）

- **八项未齐**：只对话收集；不要输出 `hermes-datasource` 块。  
- **八项已齐、用户要验证**：优先调用 MCP（或直连 BFF 同名 function tools）的 **`datasource_test_connection`**；MySQL 再按需 **`datasource_list_columns`** / **`datasource_preview_sample`**。  
- **验证通过后**：在回复**末尾**输出 **`hermes-datasource`** 或兼容 **`yaml`**，并提示用户到 **草稿卡** 完成保存；可调用 **`datasource_save_guidance`** 复读保存边界（可选）。  
- **禁止**：声称 MCP 已把数据源写入用户浏览器数据中心列表；**禁止**用容器内 Python 替代上述工具链。

技能正文详见 **`platform-skills/datasource-wizard-skill/SKILL.md`** 与内置 **`datasource-wizard-builtin-md.ts`** 中的 MCP 章节。

---

## 附录：从零开始的详细步骤（Windows + Docker Desktop 常见）

### A. 在本机构建 MCP（必做）

1. 安装 **Node.js 18+**（`node -v` 可验证）。  
2. 打开终端，进入仓库根目录下的 MCP 包：  
   `cd mcp-servers/datasource-mcp`  
3. 安装依赖并编译：  
   `npm install`  
   `npm run build`  
4. 确认生成文件存在：  
   `mcp-servers/datasource-mcp/dist/index.js`  
5. **记下该文件的绝对路径**（供 Hermes 与下文 `DATASOURCE_MCP_CLI_PATH` 使用）。  
   - 例（PowerShell）：`(Resolve-Path .\dist\index.js).Path`  
   - 例：`C:\Users\你的用户\Desktop\行业大模型\AI应用部\cursor\mcp-servers\datasource-mcp\dist\index.js`

### B. 启动统一质检平台 Next（MCP 要访问的后端）

1. 进入 `frontend`：`cd frontend`  
2. 启动：`npm run dev`  
3. 浏览器本机访问：`http://127.0.0.1:3000` 能打开即可。  
4. 若 Hermes 跑在 **Docker 里**、Next 在 **宿主机**，容器内应使用 **`http://host.docker.internal:3000`** 访问 Next（见下文 `env`）。

### C. 在 Hermes 里注册 `mcp_servers`

Hermes 从 **`config.yaml`**（通常在 **`%USERPROFILE%\.hermes`** 或 `HERMES_HOME` 所指目录）读取顶层键 **`mcp_servers`**。官方示例见 **`hermes-agent/hermes-agent-main/cli-config.yaml.example`** 中「MCP Servers」一节。

1. 用编辑器打开你实际在用的 **`config.yaml`**（与正在跑的 Gateway 使用的那份一致）。  
2. 在文件顶层增加或合并 **`mcp_servers`**，示例（**把 `args` 换成你在 A 步得到的绝对路径**）：

```yaml
mcp_servers:
  xingyan-datasource:
    command: "node"
    args:
      - "C:/Users/你的用户/Desktop/行业大模型/AI应用部/cursor/mcp-servers/datasource-mcp/dist/index.js"
    env:
      DATASOURCE_MCP_BASE_URL: "http://host.docker.internal:3000"
```

3. **路径与反斜杠**：YAML 里建议用 **正斜杠 `/`**，或按 YAML 规则转义反斜杠；**不要用**未转义的 `\`。  
4. **若 Gateway 在 Linux 容器内**：  
   - `args` 必须是 **容器内可见路径**。常见做法：在 `docker-compose` 里把宿主机仓库目录 **bind mount** 到容器内固定路径（例如 `/opt/xingyan-mcp/datasource-mcp/dist/index.js`），再把 `args` 写成该路径。  
   - `DATASOURCE_MCP_BASE_URL`：能访问到宿主 Next 即可；Docker Desktop 下仍多为 `http://host.docker.internal:3000`；纯 Linux 可改为宿主机在 docker 网桥上的 IP 或 `extra_hosts`。  
5. **容器内必须有 `node`**：stdio MCP 由 `command: node` 拉起；若镜像无 Node，需换带 Node 的镜像或在镜像中安装 Node。  
6. 保存 `config.yaml` 后 **重启 Hermes Gateway**（或依赖你方文档的「热重载」；官方 CLI 有对 `mcp_servers` 变更的监听逻辑，仍以你环境为准）。  
7. **自检**：发起一轮会走工具的对话，或查看 Gateway 日志，确认无「找不到 node / 找不到脚本 / 连接 refused」等错误；工具名应包含 **`datasource_test_connection`** 等（由 MCP 协议 discover）。

### D. 在 Cursor 里注册（可选）

1. 打开 Cursor：**Settings → MCP**（或项目下的 `.cursor/mcp.json`，以当前 Cursor 版本为准）。  
2. 增加与 **Cursor `mcpServers` 格式** 一致的一项，例如：

```json
{
  "mcpServers": {
    "xingyan-datasource": {
      "command": "node",
      "args": [
        "C:/Users/你的用户/.../mcp-servers/datasource-mcp/dist/index.js"
      ],
      "env": {
        "DATASOURCE_MCP_BASE_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

3. Next 与 Cursor 同在本机时，`DATASOURCE_MCP_BASE_URL` 用 **`http://127.0.0.1:3000`** 即可。保存后重载 MCP / 重启 Cursor（按产品说明操作）。

### E. 本站「系统管理 → MCP 服务」导出合并（可选）

用于生成 **一份 JSON** 里同时包含：**界面里已启用的自定义 MCP** + **数据源 MCP**。

1. 在 `frontend` 目录将 **`.env.example`** 里 `DATASOURCE_MCP_*` 相关行复制到 **`.env.local`**。  
2. 设置 **`DATASOURCE_MCP_CLI_PATH`** = A 步得到的 **`dist/index.js` 绝对路径**（Windows 可用 `/` 或 `\\`）。  
3. 按需设置 **`DATASOURCE_MCP_BASE_URL`**（写入导出 JSON 里子进程的 `env`，供 Hermes 宿主机/容器引用；默认 `http://127.0.0.1:3000`）。  
4. 可选：**`DATASOURCE_MCP_SERVER_NAME`** 修改合并进 JSON 里的服务名（默认 `xingyan-datasource`）。  
5. **重启 `npm run dev`**（Next 只在启动时读环境变量）。  
6. 浏览器打开本站 → **系统管理 → MCP 服务** → **导出 JSON**。  
7. 若弹窗提示已并入数据源 MCP，且接口 JSON 里 **`datasourceMcpMerged`: true**，说明合并成功；将 **`mcpServers`** 整段复制到 Hermes/Cursor 配置即可。

### G. 若界面曾出现「Failed to fetch」但 Network 里已有 `/api/chat/turn`

部分浏览器/安全软件对 **HTTP 状态非 2xx 的 `text/event-stream`** 会直接中断，Chrome 侧常表现为 **`TypeError: Failed to fetch`**（并非 MCP 未注册）。本站 BFF 已将「仅通过 SSE `turn.failed` 表达的业务失败」改为 **HTTP 200 + SSE**，请拉取最新代码并重启 `npm run dev` 后再试。

### F. 联调顺序建议

1. Next 已启动且本机 `POST http://127.0.0.1:3000/api/datasource/test` 可用（可先在前端数据中心试连）。  
2. MCP 已 `npm run build`，且 Hermes 里 `mcp_servers` 的 `args` 指向正确 **`dist/index.js`**。  
3. Hermes 容器内 `DATASOURCE_MCP_BASE_URL` 能访问到 Next（`host.docker.internal` 或等价地址）。  
4. 对话中选「数据源配置助手」，让模型在八项齐备后调用 **`datasource_test_connection`**，再在文末输出 **`hermes-datasource`** 块，前端出现草稿卡后由用户点击保存。
