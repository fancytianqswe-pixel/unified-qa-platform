# MinerU 与 Hermes 同 Docker 网络（Sidecar / 做法二）

目标：Hermes 容器内 **`MINERU_API_BASE_URL=http://mineru-api:8000`** 即可访问解析服务，**不再依赖** `host.docker.internal` 穿透到 WSL。

本仓库提供 **`hermes-agent/hermes-agent-main/docker-compose.mineru-api.sidecar.yml`**，与 **`docker-compose.docker-desktop.yml` 在同一条 `docker compose` 命令里合并**，自动加入同一工程下的 **`hermes-net`**（无需 `external` 网络名）。

---

## 0. 适用与风险

| 项 | 说明 |
|----|------|
| **Docker Desktop + WSL2** | 与当前 Hermes 部署方式一致。 |
| **官方 `mineru:latest` 镜像** | 需**本地构建**（上游未提供可直接 `docker pull` 的稳定 Hub 名时）；体积大，且默认 **NVIDIA GPU**。 |
| **无 GPU** | 注释 sidecar 中 **`gpus` / `deploy.devices`** 段；镜像内 torch 可能仍为 CUDA 版但 **`cuda.is_available()==False`**，pipeline 走 CPU（慢）。 |
| **有 GPU（推荐）** | 宿主机安装 NVIDIA 驱动；Docker Desktop 开启 **WSL2 + GPU**；sidecar 已默认 **`gpus: all`**。重建后容器内应 **`torch.cuda.is_available()==True`**。 |
| **与 WSL 8000 并存** | Sidecar **默认不映射**宿主机 `8000`，避免与 WSL 里已起的 `mineru-api` 抢端口；仅 Docker 网内 `mineru-api:8000`。 |

---

## 1. 构建 MinerU 镜像 `mineru:latest`（本仓库推荐：轻量 Dockerfile）

**推荐**：使用 **`hermes-agent/hermes-agent-main/docker/mineru-api-runtime/Dockerfile`**，由 **`docker-compose.mineru-api.sidecar.yml`** 的 **`build`** 段自动构建为 **`mineru:latest`**。特点：不在构建阶段执行 **`mineru-models-download -m all`**；PyPI 默认走 **`https://pypi.tuna.tsinghua.edu.cn/simple`**（可通过 compose **`PIP_INDEX_URL`** / 环境变量覆盖）。**`mineru[pipeline]`** 仍会拉取较大 CUDA/torch 依赖，首次构建可能 **15–40 分钟**，属正常。

在 **`hermes-agent/hermes-agent-main`** 目录执行：

```bash
docker compose -f docker-compose.docker-desktop.yml -f docker-compose.mineru-api.sidecar.yml build mineru-api
```

构建完成后：

```bash
docker image ls mineru:latest
```

**可选（上游重型镜像）**：若你自行按 [MinerU Docker 部署](https://opendatalab.github.io/MinerU/quick_start/docker_deployment/) 从 **`docker/global/Dockerfile`** 构建，同样打 **`mineru:latest`** 后，可将 sidecar 中的 **`build:` 整段删除**，仅保留 **`image: mineru:latest`**（注意上游 Dockerfile 内含 **`mineru-models-download -m all`**，构建时间与磁盘占用极大）。

### 1.1 为啥要写「本地构建」，能不能 `docker pull`？

上游维护者在社区里说明过：**没有在 Docker Hub 正式发布**「一键 `docker pull` 的官方 MinerU / mineru-api 镜像」，仓库提供的是 **Dockerfile + compose 示例**，由用户本地 **`docker build -t mineru:latest ...`**（参见 [GitHub 讨论：Docker Hub 官方镜像](https://github.com/opendatalab/MinerU/issues/1845) 及 [官方 Docker 部署文档](https://opendatalab.github.io/MinerU/quick_start/docker_deployment/)）。因此本仓库 sidecar 默认写 **`image: mineru:latest`**，并假定你已按官方流程构建出该标签。

网上若出现类似 **`mineru/mineru-api:latest`**、`MINERU_MODEL_PATH`、`./models:/models` 的「通用 compose 片段」，往往来自**别的助手臆造或混用其它项目**，与 MinerU 当前实际环境变量（常见为 **`MINERU_MODEL_SOURCE`**、**`mineru.json`**、缓存目录 **`~/.cache`** 等）**不一定一致**。若 Hub 上确有**第三方**镜像，可用 **`image: ...`** 替换，但需**自行审计**来源与版本；**不要**与本仓库 **`hermes` 的 `docker-compose` 环境变量**混为一谈——在本项目中，**`MINERU_API_BASE_URL` 应配置在 Hermes 的 `~/.hermes/config.yaml`（`mcp_servers.xingyan-mineru-api.env`）或导出 JSON**，而不是想当然写在 `gateway` 服务的 `environment:` 里（除非你们自行改过网关读 env 的逻辑）。

---

## 2. 工程目录

以下命令均在 **`hermes-agent/hermes-agent-main`** 目录执行（与 **`docker-compose.docker-desktop.yml`** 同级）。

合并 compose 后，Docker 会为该工程创建 **`hermes-net`**；**sidecar 文件里不再声明 `networks:`**，避免与主文件的 `bridge` 定义冲突。

---

## 3. 启动 Hermes + MinerU Sidecar

在 **`hermes-agent/hermes-agent-main`** 目录：

```bash
docker compose -f docker-compose.docker-desktop.yml -f docker-compose.mineru-api.sidecar.yml --profile mineru up -d
```

说明：

- **`--profile mineru`**：只在本 profile 下启动 **`mineru-api`** 服务（见 sidecar 文件）；gateway / dashboard 仍照常启动。  
- 首次拉模型可能较慢，**`healthcheck`** 在 `start_period` 内会通过。

查看日志：

```bash
docker logs -f mineru-api
```

---

## 4. 在 Hermes 容器内验证连通性

```bash
docker exec hermes node -e "fetch('http://mineru-api:8000/health').then(r=>r.text()).then(console.log).catch(e=>{console.error(e);process.exit(1)})"
```

应返回 **`"status":"healthy"`** 的 JSON。

---

## 5. 修改 MCP 配置（`MINERU_API_BASE_URL`）

在 **`~/.hermes/config.yaml`**（或你从「系统管理 → MCP 导出」合并的 JSON）中，**`xingyan-mineru-api`** 的 **`env`**：

```yaml
MINERU_API_BASE_URL: "http://mineru-api:8000"
```

删除或覆盖原先 **`http://host.docker.internal:8000`**。

然后 **重启 `hermes` 容器** 使 MCP 子进程重新读配置：

```bash
docker restart hermes
```

（若你改的是挂载卷里的 `config.yaml`，确保容器内路径为 **`/opt/data/config.yaml`** 等实际生效路径。）

---

## 6. 模型与 `MINERU_MODEL_SOURCE`

Sidecar 使用命名卷 **`mineru-model-cache`** 挂载到容器内 **`/root/.cache`**，便于持久化。

- **`mineru-config` 卷**：挂载 **`/opt/mineru-config`**，并通过环境变量 **`MINERU_TOOLS_CONFIG_JSON=/opt/mineru-config/mineru.json`** 持久化模型路径配置。仅缓存 `.cache` 而不持久化 `mineru.json` 时，`docker compose … --force-recreate` 会丢失配置，表现为 **`local` 模式下 `failed_tasks` 增加、`AttributeError: 'NoneType' object has no attribute 'get'`**。
- **首次无缓存**：可将 sidecar 中环境变量改为 **`modelscope`**（或在 `docker compose` 前导出 **`MINERU_MODEL_SOURCE=modelscope`**），在容器内执行 **`mineru-models-download -s modelscope -m pipeline`**（需 hybrid 再 **`-m vlm`**），待 **`/opt/mineru-config/mineru.json`** 生成后再改为 **`local`** 并 `docker compose up -d` 重建服务。  
- 亦可把你在 WSL 已下载好的缓存目录 **bind mount** 到 `/root/.cache`（路径与权限需自行对齐，略复杂）。

---

## 7. 本机调试 MinerU `/docs`（可选）

Sidecar 默认**不**发布宿主机端口。若要在 Windows 浏览器打开 `http://localhost:8001/docs`，在 **`docker-compose.mineru-api.sidecar.yml`** 中取消注释：

```yaml
ports:
  - "8001:8000"
```

再 `docker compose ... up -d`。

---

## 8. 停服与卸载

仅停 MinerU：

```bash
docker compose -f docker-compose.docker-desktop.yml -f docker-compose.mineru-api.sidecar.yml --profile mineru stop mineru-api
```

删除容器但保留模型卷：

```bash
docker compose -f docker-compose.docker-desktop.yml -f docker-compose.mineru-api.sidecar.yml --profile mineru rm -f mineru-api
```

彻底删卷（会丢缓存模型）：

```bash
docker volume rm hermes-agent-main_mineru-model-cache
```

（卷名前缀随 compose 工程名变化，以 **`docker volume ls`** 为准。）

---

## 9. 与「WSL 内 mineru-api」二选一

- **Sidecar 起在 Docker 里**：WSL 内 **`mineru-api` 建议停掉**，避免混淆与双倍占资源。  
- 若暂时只做验证：Sidecar 用 **`8001:8000`**，WSL 继续占 **8000**，Hermes 仍只连 **`http://mineru-api:8000`**（容器名不变）。

---

## 10. 故障排查

| 现象 | 处理 |
|------|------|
| `network ... could not be found` / compose 网络冲突 | 确认 **§3** 使用 **两条 `-f` 同一条命令** 合并；不要单独 `docker compose -f docker-compose.mineru-api.sidecar.yml up`（会缺主文件里的 `hermes-net`）。 |
| `mineru:latest not found` | 先完成 **§1 构建**。 |
| GPU 相关错误 | 安装 **NVIDIA Container Toolkit**（Docker Desktop + WSL2 GPU 支持），或删除 **`deploy`** 段试验（不保证官方镜像能在 CPU 跑）。 |
| `healthcheck` 一直失败 | 看 **`docker logs mineru-api`**；首次下载模型耗时可能超过默认 `start_period`，可适当调大 sidecar 内 **`start_period`**。 |

更多 MinerU 与 MCP 说明见 **`docs/MinerUMCP.md`**。
