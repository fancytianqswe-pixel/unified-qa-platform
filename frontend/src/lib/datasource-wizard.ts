import type { DataSourceForm, DataSourceRecord, DbKind } from "@/components/data/types";
import { connectionSummary } from "@/lib/datasource-storage";

/** 注入 Hermes / 直连模型：由大模型主导多轮问答与信息提取 */
export const DATASOURCE_DB_WIZARD_SYSTEM_PROMPT = `你是「统一质检平台」中的「数据源配置助手」：以数据库数据源配置向导身份，通过自然语言多轮对话帮助用户补齐接入信息。

## 目标
收集并确认以下字段（全部为字符串），用于写入前端的「数据中心 → 数据源管理」（本地 localStorage，与手动新增同源）：
- name：数据源显示名称
- dbKind：mysql | postgresql | sqlserver | oracle | sqlite 之一
- host：主机域名或 IP
- port：端口号（数字字符串，如 "3306"）
- database：数据库名（不能只接库不接表）
- table：数据表名
- username、password：数据库账号

## 对话要求
1. 用简洁、专业、友好的中文引导；每次优先追问**当前最缺**的信息，可结合用户已说的内容做确认。
2. 允许用户一条消息里提供多项信息，你要识别并复述已确认项。
3. 信息未齐备时**不要**输出机器可读块。
4. 当你判断**八项均已齐备且语义正确**、且用户已明确同意保存（或本轮用户表示「确认」「就这样保存」等）时，在回复**末尾**输出**一个**机器可读块（**禁止仅用 Markdown 表格收束**；二选一，**优先 hermes-datasource**）：
   - **首选**：\`\`\`hermes-datasource\`\`\` 内为合法 **JSON**（键为小写 name, dbKind, host, port, database, table, username, password）。
   - **兼容**：\`\`\`yaml\`\`\` 内为 **datasource:** 扁平段，或 **hermes_datasources:** 下列表**首条**（含 name、type 或 dbKind、host、port、database、table、username、password）；前端按 **hermes-datasource → \`\`\`json\`\`\` 八项对象 → \`\`\`yaml\`\`\`（先 datasource: 再 hermes_datasources:）** 顺序解析，命中其一即生成**同一张草稿卡片**。
   **不要**用 \`\`\`json\`\`\` 代替上述约定（除非 JSON 本身已是八项对象）；草稿卡片生成后，用户在卡片内完成：**① 连通性检测 → ②（MySQL）字段勾选 → ③ 样例 → ④ 保存到数据中心**（浏览器 localStorage，**与数据中心列表同源**）。你必须提示「请在下方卡片中点保存后才会出现在数据中心列表」。
   **password 必须为真实口令字符串**（与用户在对话中确认的一致），**禁止**在 \`hermes-datasource\` / yaml 中写 \`***\`、\`******\` 等掩码占位——否则草稿卡片探测会按字面密码连库并报 Access denied。数据仅存用户本机浏览器，可提醒勿在公网群聊传播。
   示例（password 为示意，须替换为用户提供的真实值）：
\`\`\`hermes-datasource
{"name":"订单库","dbKind":"mysql","host":"127.0.0.1","port":"3307","database":"qa_test_core","table":"products","username":"root","password":"你的真实密码"}
\`\`\`
5. **严禁**声称「已保存至数据中心」「已写入 localStorage」——在用户点击卡片「保存到数据中心」**之前**，列表不会出现新行。**严禁**引导或演示用 shell/终端在 \`~/datasources\`、\`/root\`、\`/opt/data\`、\`/opt/data/home\`、容器内任意路径写 \`.yaml\` 或 \`hermes_datasources:\` 文件并声称**已同步到数据中心列表**；那些均在 **Agent 宿主或镜像内**，与浏览器 **localStorage（\`datacenter.datasources.v1\`）** 不是同一存储。
6. **禁止**教用户粘贴「自创」的 \`localStorage.setItem\` 脚本：键名与记录形状（\`id\`/\`type\`/\`summary\`/\`config\`）必须与产品一致，模型极易写错导致列表损坏。**唯一可靠路径**是：输出可解析块 → 用户用 **草稿卡片** 或 **数据中心弹窗** 保存。
7. **用户说「测连接」「测试连接」时**：不得切换到其它技能（如各类「数据库诊断」脚本技能）在 Agent 里跑 Python；应引导用户先让助手输出 **hermes-datasource / 兼容 yaml** 出现草稿卡，再点卡片「连通性检测」，或去数据中心弹窗测连。
8. **直连模型且开启本向导时**，上游可能提供 **function tools**（\`datasource_test_connection\` / \`datasource_list_columns\` / \`datasource_preview_sample\`），与 \`/api/datasource/*\` 能力等价；你可在八项齐备**之前**用工具帮用户验证连接或预览字段，但最终仍须输出 **hermes-datasource**（或兼容 **yaml** 块）以生成草稿卡片（除非用户明确放弃保存）。
9. **Hermes 网关**（本仓库 API Server 平台）已默认注册内置工具 \`datasource_test_connection\` / \`datasource_list_columns\` / \`datasource_preview_sample\` / \`datasource_save_guidance\`（HTTP 调 Next \`/api/datasource/*\`，与 stdio 数据源 MCP 语义一致）。另可自行配置 stdio MCP，工具名多为 \`mcp_*_datasource_*\`。与第 8 条**同一语义**：用 **test / list_columns / preview** 做探活与预览，**不得**用容器内 Python 自建测链；探活成功后**仍须**输出可解析块以便草稿卡；**工具与 BFF 均不能代替用户点击「保存到数据中心」**。
10. 若用户取消配置，正常对话即可，不要输出上述代码块。

## 注意（与界面一致）
- **连通性检测与数据中心一致、必须快**：真实探测由**用户浏览器**请求本站 \`POST /api/datasource/test\`（Next 服务端再连库）完成；草稿卡片上的「连通性检测」按钮走的也是这条路径。**禁止**在对话正文里引导或演示「用 Python/pymysql、shell、bash、代码解释器」等在 Agent 宿主环境里自行连库——该环境通常**没有**数据库驱动、也**不能**替代用户前端的 BFF，只会反复报错、耗时数十秒，且与产品能力无关。**不是**「没做成 MCP 才慢」，而是**走了错误的执行形态**。
- 若用户只说「测连接」而尚未输出草稿块：优先提示其使用**已生成的草稿卡片**按钮；若上游未暴露数据源 tools，**不要**假装你能在本机跑通数据库，用简短说明即可。
- 密码敏感：提醒用户数据仅存本机浏览器；勿在公网环境明文传播。`;

const DB_KINDS = new Set<DbKind>(["mysql", "postgresql", "sqlserver", "oracle", "sqlite"]);

/** 模型 JSON 常见把 port 写成数字；与数据中心表单（字符串）对齐 */
function wizardTextField(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(Math.trunc(v));
  }
  if (typeof v === "bigint") return String(v);
  return null;
}

type WizardTurnBody = {
  context?: Record<string, string>;
  blocks?: Array<{ type?: string; name?: string; skillId?: string }>;
};

/**
 * 是否应按「数据源向导」注入系统提示并在回复中解析 hermes-datasource / 兼容 JSON 块。
 * - 前端 context.datacenterDatasourceWizard=db
 * - Hermes 已加载 datasource-wizard-skill 正文
 * - 当前轮用户消息携带「数据源配置助手」技能卡片或 Hermes id 含 datasource-wizard-skill
 */
export function isDatasourceWizardRequest(
  body: WizardTurnBody,
  skillLoad?: { usedDatasourceWizardSkillFromHermes?: boolean } | null,
): boolean {
  if (body.context?.datacenterDatasourceWizard === "db") return true;
  if (skillLoad?.usedDatasourceWizardSkillFromHermes) return true;
  const blocks = body.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((raw) => {
    const b = raw as { type?: string; name?: string; skillId?: string };
    if (!b || b.type !== "skill_card") return false;
    const name = (b.name || "").trim();
    if (name === "数据源配置助手") return true;
    const sid = (b.skillId || "").trim().toLowerCase();
    return sid.includes("datasource-wizard-skill");
  });
}

function objectToDatasourceForm(parsed: unknown): DataSourceForm | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const name = wizardTextField(o.name);
  const dbKind = wizardTextField(o.dbKind)?.toLowerCase() as DbKind | null;
  const host = wizardTextField(o.host);
  const port = wizardTextField(o.port);
  const database = wizardTextField(o.database);
  const table = wizardTextField(o.table);
  const username = wizardTextField(o.username);
  const password = wizardTextField(o.password);

  if (!name || !dbKind || !DB_KINDS.has(dbKind) || !host || !port || !database || !table || !username || !password) {
    return null;
  }

  return {
    name,
    type: "db",
    dbKind,
    host,
    port,
    database,
    table,
    username,
    password,
  };
}

/** 从 ```yaml``` 中抽取 `datasource:` 下扁平键（忽略 metadata / connection_options 等扩展段） */
function sliceYamlUnderDatasource(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^\s*datasource:\s*$/i.test(l));
  if (start < 0) return raw.trim();
  const baseIndent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = line.match(/^\s*/)?.[0].length ?? 0;
    if (ind <= baseIndent) break;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * 解析 ```yaml``` 内 `hermes_datasources:` 下列表**首项**（常见 `- name:` / `dbKind:` 缩进块），映射为八项表单。
 */
function tryParseHermesDatasourcesYamlFence(fenceBody: string): DataSourceForm | null {
  const lines = fenceBody.replace(/\r\n/g, "\n").split("\n");
  const hi = lines.findIndex((l) => /^\s*hermes_datasources:\s*$/i.test(l));
  if (hi < 0) return null;
  const rootInd = lines[hi].match(/^\s*/)?.[0].length ?? 0;
  const kv: Record<string, string> = {};
  let i = hi + 1;
  let inItem = false;
  let itemDashInd = 0;

  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) {
      i++;
      continue;
    }
    const ind = raw.match(/^\s*/)?.[0].length ?? 0;
    if (!inItem) {
      if (ind <= rootInd) break;
      const dashM = raw.match(/^\s*-\s*(.*)$/);
      if (dashM) {
        inItem = true;
        itemDashInd = ind;
        const rest = (dashM[1] ?? "").trim();
        if (rest) {
          const m0 = rest.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
          if (m0) {
            let v = m0[2].trim().replace(/\s+#.*$/, "").trim();
            v = v.replace(/^["']|["']$/g, "");
            kv[m0[1].toLowerCase()] = v;
          }
        }
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (ind <= rootInd) break;
    if (ind === itemDashInd && /^\s*-\s/.test(raw)) break;

    const t = raw.trim();
    const m = t.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === "metadata" || k === "tags" || k === "sample_rows") break;
      let v = m[2].trim().replace(/\s+#.*$/, "").trim();
      v = v.replace(/^["']|["']$/g, "");
      kv[k] = v;
    }
    i++;
  }

  const dbFrom = (kv.dbkind || kv.type || "").trim().toLowerCase();
  return objectToDatasourceForm({
    name: kv.name,
    dbKind: kv.dbkind || dbFrom,
    host: kv.host,
    port: kv.port,
    database: kv.database,
    table: kv.table,
    username: kv.username,
    password: kv.password,
  });
}

function tryParseDatasourceYamlFence(fenceBody: string): DataSourceForm | null {
  const inner = sliceYamlUnderDatasource(fenceBody.trim());
  const kv: Record<string, string> = {};
  for (const line of inner.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("- ")) continue;
    const m = t.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "connection_options" || key === "metadata" || key === "table_fields" || key === "sample_rows") break;
    let val = m[2].trim();
    val = val.replace(/\s+#.*$/, "").trim();
    val = val.replace(/^["']|["']$/g, "");
    kv[key] = val;
  }
  const dbFromType = (kv.type || kv.dbkind || "").trim().toLowerCase();
  const payload: Record<string, unknown> = {
    name: kv.name,
    dbKind: kv.dbkind || dbFromType,
    host: kv.host,
    port: kv.port,
    database: kv.database,
    table: kv.table,
    username: kv.username,
    password: kv.password,
  };
  return objectToDatasourceForm(payload);
}

/**
 * 从助手全文抽取可解析的数据源八项，并返回去掉命中代码块后的展示文案。
 *
 * **解析优先级**（先命中先返回，并从正文中移除对应围栏）：`hermes-datasource` → 所有 ` ```json` ` 围栏中首个可解析为八项对象的 JSON → 所有 ` ```yaml` ` 围栏中首个 `tryParseDatasourceYamlFence`（`datasource:` 下扁平键）成功 → 同围栏内 `tryParseHermesDatasourcesYamlFence`（`hermes_datasources:` 列表首项）。
 */
export function parseWizardDbPayload(text: string): { displayText: string; form: DataSourceForm | null } {
  const hermes = text.match(/```hermes-datasource\s*([\s\S]*?)```/i);
  if (hermes) {
    try {
      const form = objectToDatasourceForm(JSON.parse(hermes[1].trim()));
      if (form) {
        return {
          displayText: text.replace(/```hermes-datasource\s*[\s\S]*?```/i, "").replace(/\n{3,}/g, "\n\n").trim(),
          form,
        };
      }
    } catch {
      /* fall through */
    }
  }

  const jsonRe = /```json\s*([\s\S]*?)```/gi;
  let j: RegExpExecArray | null;
  while ((j = jsonRe.exec(text)) !== null) {
    try {
      const form = objectToDatasourceForm(JSON.parse(j[1].trim()));
      if (form) {
        const head = text.slice(0, j.index);
        const tail = text.slice(j.index + j[0].length);
        return { displayText: (head + tail).replace(/\n{3,}/g, "\n\n").trim(), form };
      }
    } catch {
      /* try next json fence */
    }
  }

  const yamlRe = /```ya?ml\s*([\s\S]*?)```/gi;
  let y: RegExpExecArray | null;
  while ((y = yamlRe.exec(text)) !== null) {
    const body = y[1];
    const form = tryParseDatasourceYamlFence(body) ?? tryParseHermesDatasourcesYamlFence(body);
    if (form) {
      const head = text.slice(0, y.index);
      const tail = text.slice(y.index + y[0].length);
      return { displayText: (head + tail).replace(/\n{3,}/g, "\n\n").trim(), form };
    }
  }

  return { displayText: text.trim(), form: null };
}

export function formToDatasourceRecord(form: DataSourceForm, id: string): DataSourceRecord {
  return {
    id,
    name: form.name.trim(),
    type: "db",
    summary: connectionSummary(form),
    createdAt: new Date().toISOString(),
    config: { ...form, type: "db" },
  };
}
