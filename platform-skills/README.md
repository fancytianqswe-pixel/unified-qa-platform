# 平台技能目录（Hermes 可读 / 前端可隐藏 Hermes 主目录技能）

本目录用于放置 **系统内置技能副本** 与 **用户/运营后续扩展的技能包**（每个子目录一个 `SKILL.md`），与 Hermes 默认扫描的 **`~/.hermes/skills`（API 中多为 `h0:` 前缀）** 区分开：

| 路径角色 | 说明 |
|----------|------|
| `~/.hermes/skills` | Hermes 自带与用户通过 Dashboard 默认注册落盘的位置；**Next 技能中心默认不在列表中展示**（见 `SKILLS_UI_HIDE_HERMES_HOME`）。 |
| **本目录** | 通过 `skills.external_dirs` 指向容器内 **`/opt/platform-skills`** 后，由 Gateway `/api/skills` 扫描，技能 id 一般为 **`h1:`** 起（当本目录为第一个 external 根时）。 |

## 目录约定

- `skill-creator-skill/`、`datasource-wizard-skill/`、`data-rule-audit-skill/`：与前端内置 slug 对齐，便于 BFF 注入详情与去重。
- `user/`：预留给「用户上传 / 注册」类技能子目录（可再分子目录，每个含 `SKILL.md`）。

## Docker（推荐，已接好）

本仓库 **Hermes** 的 `docker-compose.yml` 与 `docker-compose.docker-desktop.yml` 已为 **gateway** 与 **dashboard** 同时增加 **`platform-skills`** 卷（默认 **`${PLATFORM_SKILLS_BIND:-../../platform-skills}` → `/opt/platform-skills:ro`**）。

**原因说明**：Dashboard（9119）的 **`/api/skills`** 由 **`hermes_cli/web_server.py`** 调用 **`tools/skills_tool._find_all_skills`**，会读 **`config.yaml` → `skills.external_dirs`** 并在**本容器内**访问这些路径。若仅 gateway 挂载 **`/opt/platform-skills`** 而 **dashboard 未挂载**，界面仍只会列出默认 **`~/.hermes/skills`** 下的技能（常见 79 条），与 Gateway 是否已扫到 external 无关。

镜像 **`docker/entrypoint.sh`** 仅在 **gateway** 启动流程里合并 **`config.yaml`**（dashboard 与 gateway 共用 **`~/.hermes`/`/opt/data`** 卷，配置已含 `external_dirs` 即可）。

### 若 Dashboard 技能数仍是 79、搜不到 `h1:skill-creator-skill`

1. 看网关日志：`docker logs hermes 2>&1 | tail -n 40`  
   - 应出现 `[hermes entrypoint] /opt/platform-skills: … entries` 及 `ls` 列表；若 **WARNING: … missing** 或 **entries 为 0**，说明**宿主挂载未指到含 SKILL 的目录**。
2. 进容器检查（**gateway 与 dashboard 都要能访问挂载**，技能页由 dashboard 提供）：  
   `docker exec hermes ls -la /opt/platform-skills`  
   `docker exec hermes-dashboard ls -la /opt/platform-skills`  
   二者均应能看到 `skill-creator-skill`、`datasource-wizard-skill` 等子目录。
3. 检查配置：  
   `docker exec hermes grep -n external_dirs /opt/data/config.yaml`  
   应包含 `/opt/platform-skills`。
4. **Windows / 中文路径 / 从非标准目录执行 compose** 时，相对路径可能解析错。请在 **`hermes-agent/hermes-agent-main/.env`**（与 compose 同目录）中设置**绝对路径**（可复制 **`.env.example`** 改名后编辑）：  
   `PLATFORM_SKILLS_BIND=C:/你的路径/cursor/platform-skills`  
   然后 **`docker compose -f docker-compose.docker-desktop.yml up -d`**（无需 `--build` 若仅改 .env）。

挂载目录内若 **没有任何 `SKILL.md`**，合并脚本会向 stderr 打出 **WARNING**，Gateway 仍只会列出默认 `~/.hermes/skills` 下的技能（常见为 79 条）。

## 非 Docker（本机直接跑 Hermes）

在 **`~/.hermes/config.yaml`** 中自行增加：

```yaml
skills:
  external_dirs:
    - /你的绝对路径/cursor/platform-skills
```

（路径须为 Hermes 进程可见的绝对路径。）

## 前端环境变量

在 Next 应用目录（`cursor/frontend`）复制 **`.env.example` → `.env.local`** 后重启 `npm run dev`。

| 变量 | 说明 |
|------|------|
| `HERMES_GATEWAY_URL` | **推荐**，网关根 URL（填写你环境里**实际可达**的地址，勿写死本机回环示例），用于技能 API 与**对话**流式走 Hermes；容器内访问宿主机网关时常用 `http://host.docker.internal:<端口>`（以实际端口为准） |
| `API_SERVER_KEY` / `HERMES_API_KEY` | 与 Gateway `API_SERVER_KEY` 一致，请求头 `Authorization: Bearer …`；`docker-compose.docker-desktop.yml` 未改时默认常为 `hermes-local-docker-desktop-dev` |
| `HERMES_TURN_ENDPOINT` | 可选，自定义 Turn SSE；不配时 BFF 仍会用 `HERMES_GATEWAY_URL` 及内置候选探测 `/v1/chat/completions` |
| `SKILLS_UI_HIDE_HERMES_HOME` | 设为 `0` / `false` 时**不过滤** `h0:`；设为 `1` / `true` 或未设置时**过滤掉** `~/.hermes/skills` 根下的技能，仅展示 external 与本地兜底合并结果。 |

未挂载本目录、且过滤开启时，远端列表可能只剩空；可将 `SKILLS_UI_HIDE_HERMES_HOME=0` 临时关闭过滤。

## 与「技能中心注册」的关系

当前 Hermes 自带注册接口仍默认写入 **`~/.hermes/skills`**（`h0`）。若希望注册项出现在「非 h0」且被本前端展示，需要后续把注册落盘改到 **`platform-skills/user/`** 或改 Hermes 侧目标目录。
