# 统一质检平台 · 数据源 stdio MCP

独立 Node 进程，通过 **Model Context Protocol (stdio)** 向 Hermes / Cursor 等提供与数据中心一致的 DB 探测能力；内部用 `fetch` 调用本仓库 **Next** 的 `POST /api/datasource/test|columns|preview`。

## 工具一览

| 工具名 | 说明 |
|--------|------|
| `datasource_test_connection` | 连通性，等价 `/api/datasource/test` |
| `datasource_list_columns` | MySQL 列清单，`/api/datasource/columns` |
| `datasource_preview_sample` | 最多 5 行样例，`/api/datasource/preview`（可选 `selectedFields`） |
| `datasource_save_guidance` | 无参数；返回如何把配置写入浏览器数据中心的说明（不执行保存） |

## 构建与本地试跑

```bash
cd mcp-servers/datasource-mcp
npm install
npm run build
# 另开终端先启动 Next：frontend 目录 npm run dev
set DATASOURCE_MCP_BASE_URL=http://127.0.0.1:3000
node dist/index.js
```

宿主连接 stdio 后应能 `list_tools` 看到上述四项。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DATASOURCE_MCP_BASE_URL` | `http://127.0.0.1:3000` | Next 根 URL，**无**尾部斜杠 |

Hermes 跑在 Docker、Next 在宿主机 Windows/Mac 时，常设为 `http://host.docker.internal:3000`（需本机防火墙放行 3000）。

## Hermes `config.yaml` 示例片段

（字段名以你方 Hermes 版本为准，常见为 `mcp_servers` 映射。）

```yaml
mcp_servers:
  xingyan-datasource:
    command: "node"
    args:
      - "C:/绝对路径/到/cursor/mcp-servers/datasource-mcp/dist/index.js"
    env:
      DATASOURCE_MCP_BASE_URL: "http://host.docker.internal:3000"
```

Linux 容器内请把 `args` 换成挂载进容器的路径（例如 `/opt/mcp/datasource-mcp/dist/index.js`）。

## 与本站「系统管理 → MCP 服务」导出

在 **frontend** 的 `.env.local` 中设置 `DATASOURCE_MCP_CLI_PATH` 指向本包的 `dist/index.js` 后，`GET /api/system/mcp-services/export` 会在 `mcpServers` JSON 里**自动合并**一条 stdio 定义，与你在界面里手动添加、已启用的 MCP **一起**导出，便于粘贴到 Cursor 或写入 Hermes 配置。

详见仓库根目录 **`docs/Hermes数据源MCP.md`**。
