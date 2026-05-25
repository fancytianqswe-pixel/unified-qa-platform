# 统一质检平台

基于 Next.js 前端 + Hermes Agent + MCP 的数据质检与规则审核平台。

## 快速开始

```bash
cd frontend
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm run dev
```

浏览器访问 http://localhost:3000 ，默认账号 `admin` / `admin`。

## 目录结构

| 目录 | 说明 |
|------|------|
| `frontend/` | Next.js 应用（UI + BFF API） |
| `hermes-agent/hermes-agent-main/` | Hermes 网关（Docker） |
| `mcp-servers/` | MinerU、数据源等 MCP 服务 |
| `platform-skills/` | 平台内置技能 |
| `docs/` | PRD、需求说明、集成文档 |

## 文档

- [PRD](docs/PRD-统一质检平台.md)
- [需求与实现说明](docs/需求说明.md)

## 推送到 GitHub

见 `scripts/Publish-ToGitHub.ps1` 或 `docs/需求说明.md` 中的「Git 仓库与推送」章节。
