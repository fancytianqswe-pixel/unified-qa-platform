# Hermes / Cursor 接入 MinerU（双 MCP）

[MinerU](https://github.com/opendatalab/MinerU) 将 PDF、图片、Office 等转为 Markdown / JSON 等结构化结果；产品介绍见 [MinerU 提取器](https://mineru.net/OpenSourceTools/Extractor)。

本仓库不内嵌 MinerU 本体（依赖较重、含模型与算力栈），而是提供 **两个独立的 stdio MCP 包**，由部署方按需安装上游 `mineru` / 启动 `mineru-api` 后注册到 Hermes 或 Cursor。

## 能力拆分与选型

| MCP 包 | 默认注册名 | 典型场景 | 依赖 |
|--------|-------------|----------|------|
| `mcp-servers/mineru-local-mcp` | `xingyan-mineru-local` | 解析与对话同机；直接调用 `mineru -p -o …` | 本机已安装 MinerU CLI（PyPI `mineru`）及官方文档要求的模型/后端 |
| `mcp-servers/mineru-api-mcp` | `xingyan-mineru-api` | 已有独立 **mineru-api** 服务（FastAPI）；MCP 只读本地文件并 `POST /file_parse` | 可访问的 `MINERU_API_BASE_URL`；MCP 进程能 `readFile` 到待传文件 |

**为何拆两个进程**：本地 CLI 往往绑定 GPU、长超时与大体量输出；HTTP 客户端轻量，适合 Hermes 与解析服务分层部署。二者工具名不同，可按环境只启用其一，避免同一对话加载重复能力。

## 1. 构建

```bash
cd mcp-servers/mineru-local-mcp && npm install && npm run build
cd ../mineru-api-mcp && npm install && npm run build
```

入口分别为 `dist/index.js`。

## 2. Hermes `mcp_servers` 注册（示意）

### 仅本地 CLI

```yaml
mcp_servers:
  xingyan-mineru-local:
    command: "node"
    args:
      - "/绝对路径/mcp-servers/mineru-local-mcp/dist/index.js"
    env:
      MINERU_EXECUTABLE: "mineru"
      MINERU_CLI_TIMEOUT_MS: "600000"
```

### 仅 HTTP API

先在上游环境启动 `mineru-api`（默认 `127.0.0.1:8000`，见 MinerU 文档）。

```yaml
mcp_servers:
  xingyan-mineru-api:
    command: "node"
    args:
      - "/绝对路径/mcp-servers/mineru-api-mcp/dist/index.js"
    env:
      MINERU_API_BASE_URL: "http://127.0.0.1:8000"
      # 推荐生产设置，仅允许读取某根目录下文件：
      # MINERU_API_ALLOWED_READ_PREFIX: "/data/mineru-inbox"
```

## 3. 与「系统管理 → MCP 服务」导出合并

与数据源 MCP 相同：在 `frontend/.env.local` 中配置：

- `MINERU_LOCAL_MCP_CLI_PATH` / `MINERU_API_MCP_CLI_PATH`：指向对应 `dist/index.js` 的**绝对路径**
- 可选：`MINERU_LOCAL_MCP_SERVER_NAME`、`MINERU_API_MCP_SERVER_NAME` 覆盖默认名
- 可选：`MINERU_EXECUTABLE`、`MINERU_CLI_TIMEOUT_MS`、`MINERU_API_BASE_URL`、`MINERU_API_ALLOWED_READ_PREFIX`、`MINERU_API_DEFAULT_BACKEND`（不设时 **`mineru-api-mcp` 对 `/file_parse` 默认使用 `pipeline`**；需 hybrid/VLM 时请设为 `hybrid-auto-engine` 等，或在工具参数中传 `backend`）

调用 `GET /api/system/mcp-services/export` 时，响应除 `datasourceMcpMerged` 外会包含：

- `mineruLocalMcpMerged`
- `mineruApiMcpMerged`

## 4. 暴露的工具一览

**mineru-local-mcp**

- `mineru_local_health`：`MINERU_EXECUTABLE --version`
- `mineru_local_parse`：封装 `mineru -p <inputPath> -o <outputDir>` 及常用 `-m/-b/-l/-u/--api-url/-s/-e/-f/-t` 等参数

**mineru-api-mcp**

- `mineru_api_health`：`GET /health`
- `mineru_api_sync_parse`：`POST /file_parse`（小文件/联调；大 PDF 易长连接中断）
- **`mineru_api_parse_and_wait`（推荐）**：`POST /tasks` 后由 MCP **内建轮询**直至 `completed`/`failed`；失败、409、轮询/拉结果异常时按 **`MINERU_PARSE_MAX_RETRIES`**（默认 3）重试；环境变量 **`MINERU_POLL_INTERVAL_MS`**（默认 5000）、**`MINERU_POLL_MAX_WAIT_MS`**（默认 2h）、**`MINERU_PARSE_RETRY_DELAY_MS`**（默认 5000）
- `mineru_api_submit_parse_task`：`POST /tasks`（仅提交；一般不必再手写轮询）
- `mineru_api_task_status`：`GET /tasks/{task_id}`
- `mineru_api_task_result`：`GET /tasks/{task_id}/result`（大 JSON 可能截断）

**Hermes 注册**：在 **`~/.hermes/config.yaml`** 的 **`mcp_servers`** 中加入 **`command: node`** + **`args: [<mineru-api-mcp>/dist/index.js 绝对路径>]`** + **`env`**（至少 **`MINERU_API_BASE_URL`**）。可复制模板 **`docs/Hermes-mineru-mcp.example.yaml`** 修改路径后粘贴。若使用本站 **「系统管理 → MCP 服务」** 的导出 JSON，配置好 **`frontend/.env.local`** 中的 **`MINERU_API_MCP_CLI_PATH`** 等后调用 **`GET /api/system/mcp-services/export`**，将返回体里的 **`xingyan-mineru-api`** 合并进 Hermes 配置即可。

**Hermes 内工具名**：Hermes 会为 MCP 工具加前缀，形如 **`mcp_<服务器名>_<工具名>`**（例如服务器名为 **`xingyan-mineru-api`** 时，健康检查为 **`mcp_xingyan-mineru-api_mineru_api_health`**）。详见仓库内 **`hermes-agent/hermes-agent-main/website/docs/user-guide/features/mcp.md`**。

## 5. 许可说明

MinerU 3.x 起使用 **MinerU Open Source License**（见上游仓库 `LICENSE.md`）。集成到商业产品前请自行做法务评估。

## 6. Windows 主机 Hermes + WSL2（Ubuntu）运行 `mineru-api`

典型拆分：**解析与模型在 WSL2**，**Hermes Gateway / Dashboard 与 Next（MCP 导出 BFF）在 Windows**；MCP 子进程为 **Windows 上的 Node**，读 **Windows 本地文件路径**，经 HTTP 把文件体 `POST` 到 WSL 内的 FastAPI，不依赖 WSL 能否直接访问 NTFS 路径。

1. **在 WSL Ubuntu 安装 MinerU**（与 [官方 README](https://github.com/opendatalab/MinerU) 一致，示例）：

   ```bash
   pip install --upgrade pip
   pip install uv
   uv pip install -U "mineru[all]"
   ```

   **国内 PyPI 镜像（推荐）**：大依赖下载可改用清华镜像，例如：

   ```bash
   PYPI=https://pypi.tuna.tsinghua.edu.cn/simple
   export UV_DEFAULT_INDEX="$PYPI"
   python3 -m venv ~/mineru-venv
   source ~/mineru-venv/bin/activate
   pip install -U pip uv -i "$PYPI"
   uv pip install -U "mineru[all]" --index-url "$PYPI"
   ```

   **`mineru[all]`** 会拉取 vLLM 与大量 CUDA 相关轮子，下载时间与磁盘占用显著；若机器吃紧，请按官方说明改用更轻的 **extras**（如 **`mineru[pipeline]`** 等）。

   **安装用户**：建议在 WSL **默认登录用户** 的 **`$HOME/mineru-venv`** 下安装，与 `scripts/wsl-start-mineru-api.sh` 中 **`$HOME/mineru-venv/bin/mineru-api`** 的探测顺序一致。若虚拟环境装在 **`root`** 的 **`/root/mineru-venv`**，启动脚本仍会尝试该路径；此时普通用户需能沿目录链执行到解释器（常见做法是由管理员评估后执行 **`chmod o+x /root`**，仅开放「路过」权限），或改为在默认用户下重建 venv。

   首次需下载模型（**国内建议 ModelScope 源**；在 **与 `mineru-api` 同一用户**下执行，使 `~/mineru.json` 与进程一致）。推荐一键脚本（依次拉 **pipeline** 与 **vlm**，含图 / hybrid 解析依赖后者）：

   ```bash
   bash scripts/wsl-download-mineru-models.sh
   ```

   或手工：

   ```bash
   mineru-models-download -s modelscope -m pipeline
   mineru-models-download -s modelscope -m vlm   # hybrid/VLM 必需；体积大
   # 或一次性：-m all
   ```

   下载完成后，**`mineru-api` 应使用已落盘权重**，避免解析时仍去 HuggingFace 找快照失败。本仓库 **`scripts/wsl-start-mineru-api.sh`**：若存在 **`$HOME/mineru.json`** 则默认 **`MINERU_MODEL_SOURCE=local`**；**若不存在**则默认 **`modelscope`**（首次拉取），避免「误设 local 却无缓存」导致 VLM 仍走 Hub、**`/health` 里 `failed_tasks` 持续增加**。可用环境变量显式覆盖为 **`local`** / **`modelscope`** / **`huggingface`**。手工启动 **`mineru-api`** 时同理。

2. **启动 API**（默认监听 `127.0.0.1:8000`；若从 Windows 访问失败，可改为监听所有接口并改用 WSL IP）：

   ```bash
   mineru-api --host 127.0.0.1 --port 8000
   # 必要时：mineru-api --host 0.0.0.0 --port 8000
   # 在 Windows PowerShell 查看 WSL 地址：wsl -d Ubuntu hostname -I
   ```

   Windows 11 若在 WSL 中启用 **localhost 转发**，一般可直接使用 `http://127.0.0.1:8000` 作为 **`MINERU_API_BASE_URL`**；若不通，改用 `http://<WSL_IP>:8000`。

3. **在 Windows 侧配置**：
   - `frontend/.env.local`：设置 **`MINERU_API_MCP_CLI_PATH`** 为本仓库 **`mcp-servers/mineru-api-mcp/dist/index.js`** 的 **Windows 绝对路径**，**`MINERU_API_BASE_URL`** 指向上一步可达的 API 根地址。
   - 重启 **`npm run dev`**（Next 仅在启动时加载 `.env.local`）。
   - 在 Hermes 的 **`mcp_servers`** 中可复制导出 JSON 中的 **`xingyan-mineru-api`** 条目，或自行写 `command: node` + `args` + `env`。

4. **算力与内存**：官方推荐 **≥16GB RAM**；VLM 路径对显存要求更高。你方环境（16GB 系统内存 + 6GB 显存）可优先使用 **`pipeline` / CPU** 或按官方 FAQ 确认 GPU 栈，避免 OOM。

产品介绍与能力说明可参考 [MinerU 提取器](https://mineru.net/OpenSourceTools/Extractor)。

## 7. 仓库内辅助脚本（Windows → WSL）

- **`scripts/wsl-download-mineru-models.sh`**：在 WSL 内以 **`MINERU_MODEL_SOURCE=modelscope`** 依次执行 **`mineru-models-download -m pipeline`** 与 **`-m vlm`**，写入 **`~/mineru.json`**。用于 **`GET /health` 中 `failed_tasks` 很高**、日志出现 **`LocalEntryNotFoundError`** / **`snapshot_download`**（如 **`opendatalab/MinerU2.5-*`**）时补齐本地权重；完成后重启 **`mineru-api`**，并建议 **`MINERU_MODEL_SOURCE=local`**。
- **`scripts/wsl-start-mineru-api.sh`**：在 WSL 内查找 `mineru-api`（`PATH` 或常见 venv 路径），用 **`nohup`** 后台启动，默认 **`0.0.0.0:8000`**，日志 **`/tmp/mineru-api.log`**，PID **`/tmp/mineru-api.pid`**。可通过环境变量覆盖：`MINERU_API_LISTEN_HOST`、`MINERU_API_LISTEN_PORT`、`MINERU_API_LOG`、`MINERU_API_PIDFILE`。
- **`scripts/Run-DownloadMineruModels-Wsl.ps1`**：从 Windows 以 **`wsl -d Ubuntu-24.04`** 执行 **`wsl-download-mineru-models.sh`**（Base64 写入 `/tmp`，与 **`Start-MineruApi-Wsl.ps1`** 同套路，避免仓库路径含中文时出错）。可选 **`-Distro`**。
- **`scripts/Start-MineruApi-Wsl.ps1`**：从 Windows PowerShell 调用发行版 **`Ubuntu-24.04`**（脚本 `-Distro` 默认值）执行上述 shell；若 `wsl -l -v` 的 **`*` 默认发行版** 不是 Ubuntu（例如为 **docker-desktop**），请显式指定：**`-Distro Ubuntu-24.04`**。

### 7.1 `/health` 与 `failed_tasks`

- **`status: healthy`** 只表示进程在跑，**不保证**每条解析任务成功；**`failed_tasks`** 为历史失败计数（或受保留策略影响），新任务仍失败时会继续上升。
- **常见原因**：未下载 **VLM** 权重却走了 **hybrid**；**`MINERU_MODEL_SOURCE=local`** 但 **`mineru.json` 缺失或路径空**，回退 Hub 又网络不通；显存不足 OOM。
- **处理**：在 WSL 执行 **`scripts/wsl-download-mineru-models.sh`**（或按需 **`mineru-models-download`**），确认 **`~/mineru.json`** 与 **`mineru-api` 运行用户**一致；重启 API；Windows 侧 **`http://127.0.0.1:8000` 超时**时见上文 **WSL IP** 与防火墙。

示例（在仓库根目录执行；路径含中文时请用本脚本，勿手写 `/mnt/c/...` 以免 `wslpath` 乱码）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-MineruApi-Wsl.ps1 -Distro Ubuntu-24.04
```

安装未完成时脚本会提示先在 WSL 内执行官方 `pip`/`uv` 安装。

## 8. Docker 与 Hermes 同网（Sidecar，`http://mineru-api:8000`）

若 Hermes 在容器内无法通过 **`host.docker.internal:8000`** 访问 WSL 中的 `mineru-api`，可将 MinerU FastAPI 作为 **与 gateway 同一 `docker compose` 工程** 的 sidecar 服务启动，Hermes MCP 中设置 **`MINERU_API_BASE_URL=http://mineru-api:8000`**。详细步骤见 **`docs/MinerUDockerSidecar.md`**；Compose 见 **`hermes-agent/hermes-agent-main/docker-compose.mineru-api.sidecar.yml`**。镜像默认由 **`docker/mineru-api-runtime/Dockerfile`** 本地构建（**`mineru[pipeline]`** + 清华 PyPI），**非**上游 `docker/global` 全量构建；需上游 vLLM 全镜像时请自行 **`docker build`** 后改 sidecar 为仅 **`image: mineru:latest`**。
