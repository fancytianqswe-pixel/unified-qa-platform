/**
 * 过程步骤「胶囊条」展示用：从原始 message / JSON 归纳**一行**，说明**该工具/步骤在做什么**（意图与动作），
 * 成败、stderr、下一步建议放在展开区，不在胶囊里复述。
 */

import { UI_HEURISTIC_SCAN_MAX } from "@/lib/process-payload-limit";

export function collapseWs(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** 部分上游会把 JSON 键名弯引号化，导致 JSON.parse 失败 */
function normalizeJsonLikeAsciiQuotes(raw: string) {
  return raw.replace(/[\u201C\u201D\uFF02]/g, '"').replace(/\u2018|\u2019/g, "'");
}

/** 从「前缀 + JSON」类 Hermes 过程文案里取出第一个顶层 `{ ... }` */
export function extractFirstJsonObject(raw: string): string | null {
  const src = raw.trim();
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseObject(chunk: string | null): Record<string, unknown> | null {
  if (!chunk) return null;
  try {
    const o = JSON.parse(chunk) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    return o as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tryParseJsonArray(raw: string): unknown[] | null {
  let t = raw.trim();
  const lb = t.indexOf("[");
  if (lb > 0) t = t.slice(lb);
  if (!t.startsWith("[")) return null;
  try {
    const v = JSON.parse(t) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** JSON.parse 失败时，从含转义引号的片段里尽量抽出技能名与描述（Hermes 偶发截断/脏字符） */
function tryLooseSkillMetaSummary(blob: string): string | null {
  const b = normalizeJsonLikeAsciiQuotes(blob);
  const unescapedProbe = b.replace(/\\"/g, '"');
  const hasSuccess =
    /"success"\s*:\s*true/.test(b) ||
    /\\"success\\"\s*:\s*true/.test(b) ||
    /"success"\s*:\s*true/.test(unescapedProbe);
  if (!hasSuccess) return null;

  const nameM =
    b.match(/"name"\s*:\s*"((?:[^"\\]|\\.){0,200})"/) ??
    b.match(/\\"name\\"\s*:\s*\\"((?:[^"\\]|\\.){0,200})\\"/);
  if (!nameM?.[1]) return null;
  const name = nameM[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
  if (!name) return null;

  const descM =
    b.match(/"description"\s*:\s*"((?:[^"\\]|\\.){0,400})/) ??
    b.match(/\\"description\\"\s*:\s*\\"((?:[^"\\]|\\.){0,400})/);
  let desc = "";
  let fullDesc = "";
  if (descM?.[1]) {
    fullDesc = collapseWs(descM[1].replace(/\\"/g, '"').replace(/\\n/g, " "));
    desc = fullDesc.slice(0, 72);
  }
  return desc
    ? `载入技能「${name}」说明：${desc}${fullDesc.length > 72 ? "…" : ""}`
    : `载入技能「${name}」的元数据`;
}

function firstMeaningfulLineFromBlob(blob: string): string {
  const lines = blob.split(/\r?\n/).map((l) => collapseWs(l)).filter(Boolean);
  for (const l of lines) {
    if (/^[-=_]{3,}$/.test(l)) continue;
    if (/^Traceback|^File "|^\s*at\s+/i.test(l)) continue;
    if (l.length < 4) continue;
    return l;
  }
  return collapseWs(blob).slice(0, 140);
}

/**
 * Hermes 工具常见「内层 JSON」：无 `status` 仅有 output/exit_code、写文件 bytes_written、补丁 diff 等。
 * 另：上游常把 HTTP/表查询包在 `{ "result": "<stringified json>" }`（多层 string），顶层无 `httpStatus`，
 * 由 `summarizeToolInnerWithResultPeeling` 剥开后再归纳。
 */
const JSON_STRING_PEEL_KEYS = ["result", "data", "payload", "body", "text"] as const;

/**
 * BFF / Hermes 偶发双重（或多重）`{ "result": "<stringified json>" }`，仅 `JSON.parse` 一层时
 * `httpStatus` 仍落在字符串里，`summarizeToolJsonInner` 无法命中；循环剥 `result` 直至无进展。
 */
function peelChainedResultJsonStrings(text: string): string {
  let t = normalizeJsonLikeAsciiQuotes(text.trim());
  for (let i = 0; i < 10; i++) {
    const slice = extractFirstJsonObject(t) ?? (t.startsWith("{") ? t : null);
    const o = tryParseObject(slice);
    if (!o) break;
    const r = o.result;
    if (typeof r !== "string" || !r.trim()) break;
    const next = normalizeJsonLikeAsciiQuotes(r.trim());
    if (!(next.startsWith("{") || next.startsWith("["))) break;
    t = next;
  }
  return t;
}

/** 在多重 `\"` 转义下仍能判断是否存在 `httpStatus` + 三位状态码 */
function blobHasHttpStatusCode(blob: string): boolean {
  let d = normalizeJsonLikeAsciiQuotes(blob);
  for (let i = 0; i < 6; i++) {
    if (/httpStatus["'\s]*:\s*["']?\d{3}/i.test(d)) return true;
    if (/httpStatus\s*=\s*\d{3}/i.test(d)) return true;
    const d2 = d.replace(/\\"/g, '"');
    if (d2 === d) break;
    d = d2;
  }
  return false;
}

/** `/api/datasource/test` 等：内层 `message` 与 `diagnostics` 与 `httpStatus` 同包 */
function tryLooseConnectivityProbeSummary(blob: string): string | null {
  const b = normalizeJsonLikeAsciiQuotes(blob);
  if (!/httpStatus/i.test(b)) return null;
  const flat = b.replace(/\\"/g, '"').replace(/\s+/g, " ");
  if (
    !/真实连通|连通性探测|connectivity|queryProbe|diagnostics|network|auth/i.test(flat) &&
    !/database|mysql|dbKind|schema|table|host.*port/i.test(flat)
  ) {
    return null;
  }
  if (/真实连通|连通性探测成功|queryProbe|diagnostics.*network|"ok"\s*:\s*true|"status"\s*:\s*"success"/i.test(flat)) {
    return "检测数据源或接口的连通性";
  }
  return null;
}

function summarizeToolInnerWithResultPeeling(inner: Record<string, unknown>): string | null {
  let cur: Record<string, unknown> | null = inner;
  for (let depth = 0; depth < 6 && cur; depth++) {
    const line = summarizeToolJsonInner(cur);
    if (line) return line;

    let advanced = false;
    for (const key of JSON_STRING_PEEL_KEYS) {
      const r = cur[key];
      if (r != null && typeof r === "object" && !Array.isArray(r)) {
        cur = r as Record<string, unknown>;
        advanced = true;
        break;
      }
      if (typeof r !== "string" || !r.trim()) continue;
      const t = r.trim();
      if (!t.startsWith("{") && !t.startsWith("[")) continue;
      const normalized = normalizeJsonLikeAsciiQuotes(t);
      const slice =
        extractFirstJsonObject(normalized) ?? (normalized.startsWith("{") ? normalized : null);
      const next = tryParseObject(slice);
      if (next) {
        cur = next;
        advanced = true;
        break;
      }
      const looseHttp = tryLooseHttpApiInHermesBlob(r);
      if (looseHttp) return looseHttp;
      const looseEnv = tryLooseHermesEnvelopeHeuristic(r);
      if (looseEnv) return looseEnv;
    }
    if (advanced) continue;
    break;
  }
  return null;
}

/** JSON.parse 失败、或内层 `result` 字符串无法 parse 时：凭 httpStatus/rows 碎片归纳为一行意图 */
function tryLooseHttpApiInHermesBlob(blob: string): string | null {
  const b = normalizeJsonLikeAsciiQuotes(blob);
  if (!b.trim()) return null;
  const hermesEnvelope =
    /^\s*\[\s*\{/.test(b) ||
    /"type"\s*:\s*"(?:input_text|output_text)"/i.test(b) ||
    /\\"type\\"\s*:\s*\\"(?:input_text|output_text)\\"/i.test(b);
  const jsonWithHttp =
    /^\s*\{/.test(b) && (/httpStatus/i.test(b) || /\\"httpStatus\\"/i.test(b));
  if (!hermesEnvelope && !jsonWithHttp) return null;
  if (!/httpStatus/i.test(b)) return null;
  if (!blobHasHttpStatusCode(b)) return null;
  const conn = tryLooseConnectivityProbeSummary(b);
  if (conn) return conn;
  if (/task_id|taskId/i.test(b) && (/file_names|fileNames|pending|processing|submitted|202/i.test(b) || /"status"\s*:\s*"/i.test(b))) {
    return "向解析或抽取服务提交异步任务";
  }
  const rowsSig = /"rows"\s*:\s*\[/.test(b) || /\\"rows\\"\s*:\s*\[/.test(b);
  return rowsSig ? "通过接口查询业务表并拉取样例行" : "向已配置接口发起 HTTP 请求";
}

/**
 * 整段仍像 Hermes 信封但 parse 失败时：用正则覆盖 `status:error`、MinerU/异步 task、仅 output 等。
 */
function tryLooseHermesEnvelopeHeuristic(blob: string): string | null {
  const b = normalizeJsonLikeAsciiQuotes(blob);
  if (!b.trim()) return null;
  const env =
    /^\s*\[\s*\{/.test(b) ||
    /"type"\s*:\s*"(?:input_text|output_text)"/i.test(b) ||
    /\\"type\\"\s*:\s*\\"(?:input_text|output_text)\\"/i.test(b);
  if (!env) return null;

  if (
    /"status"\s*:\s*"error"/i.test(b) ||
    /\\"status\\"\s*:\s*\\"error\\"/i.test(b) ||
    /'status'\s*:\s*'error'/i.test(b)
  ) {
    if (/ModuleNotFoundError|ImportError|Traceback|SyntaxError|No module named|stderr/i.test(b)) {
      return "运行 Python 脚本或内联代码";
    }
    return "在用户环境中执行脚本或 shell 命令";
  }

  if (/task_id|taskId/i.test(b) && (/file_names|fileNames|pending|processing|submitted|mineru|parse/i.test(b) || /\b20[12]\b/.test(b))) {
    return "向解析或抽取服务提交异步任务";
  }

  if (/httpStatus/i.test(b)) {
    const d = b.replace(/\\"/g, '"');
    if (blobHasHttpStatusCode(b) || /httpStatus["'\s]*:\s*["']?\d{3}/i.test(d)) {
      const conn = tryLooseConnectivityProbeSummary(b);
      if (conn) return conn;
      if (/task_id|taskId|pending|processing|file_names|fileNames/i.test(b)) {
        return "向解析或抽取服务提交异步任务";
      }
      if (/"rows"\s*:\s*\[/i.test(d)) return "通过接口查询业务表并拉取样例行";
      return "向已配置接口发起 HTTP 请求";
    }
  }

  if (/"output"\s*:\s*"/i.test(b) || /\\"output\\"\s*:\s*\\"/i.test(b)) {
    if (/Traceback|ModuleNotFoundError|SyntaxError|ImportError|hermes_sandbox|script\.py/i.test(b)) {
      return "运行 Python 脚本或内联代码";
    }
    if (/\\n.*\.(py|json|txt|md)\b|\.py\\n|__pycache__|site-packages/i.test(b)) {
      return "收集命令或脚本的标准输出与结果路径";
    }
  }

  return null;
}

function summarizeToolJsonInner(inner: Record<string, unknown>): string | null {
  const httpSt = typeof inner.httpStatus === "number" ? inner.httpStatus : null;
  if (httpSt != null) {
    const msg = typeof inner.message === "string" ? inner.message : "";
    const diag = inner.diagnostics != null ? JSON.stringify(inner.diagnostics) : "";
    if (
      /真实连通|连通性探测|queryProbe|diagnostics/i.test(msg + diag) ||
      (typeof inner.ok === "boolean" &&
        inner.ok &&
        /真实连通|连通性探测|queryProbe|network|auth/i.test(msg + diag))
    ) {
      return "检测数据源或接口的连通性";
    }
    const rows = Array.isArray(inner.rows) ? inner.rows.length : null;
    if (rows != null) return "通过接口查询业务表并拉取样例行";
    const jobSt =
      typeof inner.status === "string"
        ? inner.status.trim().toLowerCase()
        : typeof inner.job_status === "string"
          ? String(inner.job_status).trim().toLowerCase()
          : "";
    const hasTask =
      (typeof inner.task_id === "string" && inner.task_id.trim().length > 4) ||
      (typeof inner.taskId === "string" && inner.taskId.trim().length > 4);
    if (
      hasTask &&
      (httpSt === 202 ||
        httpSt === 201 ||
        jobSt === "pending" ||
        jobSt === "processing" ||
        jobSt === "submitted" ||
        Array.isArray(inner.file_names) ||
        Array.isArray(inner.fileNames))
    ) {
      return "向解析或抽取服务提交异步任务";
    }
    return "向已配置接口发起 HTTP 请求";
  }

  const innerName = typeof inner.name === "string" ? inner.name.trim() : "";
  if (inner.success === false && !innerName) {
    return "调用上游工具或接口";
  }

  /** 仅有 `error` 字段、无显式 success 的 JSON（如 MCP 原始错误） */
  if (
    !innerName &&
    typeof inner.error === "string" &&
    inner.error.trim() &&
    inner.success !== true &&
    inner.success !== 1 &&
    inner.success !== false
  ) {
    const e = collapseWs(inner.error);
    if (/Method not found|McpError|MCP call failed/i.test(e)) return "调用 MCP 或托管工具接口";
    return "调用上游工具服务";
  }

  if (typeof inner.total_count === "number") {
    const hasMatches = Array.isArray(inner.matches);
    return hasMatches ? "在工作区内按模式搜索路径或内容" : "在工作区内检索并汇总匹配项";
  }

  if (Array.isArray(inner.files)) {
    return "按文件名模式查找仓库或目录中的文件";
  }

  const readPath =
    typeof inner.path === "string"
      ? inner.path.trim()
      : typeof inner.file_path === "string"
        ? inner.file_path.trim()
        : typeof inner.target_file === "string"
          ? inner.target_file.trim()
          : "";
  const stRead = typeof inner.status === "string" ? inner.status.trim().toLowerCase() : "";
  const contentStr =
    typeof inner.content === "string"
      ? inner.content
      : typeof inner.lines === "string"
        ? inner.lines
        : "";
  if (readPath && (contentStr.length > 0 || stRead)) {
    return "读取指定路径下的文件正文";
  }

  const bytesW = inner.bytes_written;
  if (typeof bytesW === "number") {
    return "将内容写入目标路径上的文件";
  }

  if (inner.success === true && typeof inner.diff === "string" && inner.diff.trim()) {
    return "对代码或文本应用补丁（diff）";
  }

  const outStr = typeof inner.output === "string" ? inner.output : "";
  const hasEc = typeof inner.exit_code === "number";
  const hasStatus = typeof inner.status === "string";

  /** 仅 `output`、无 `status`/`exit_code`：Hermes execute 列目录、列包文件等 */
  if (outStr.trim() && !hasStatus && !hasEc && typeof inner.command !== "string") {
    const sample = outStr.slice(0, 4000);
    if (/Traceback|ModuleNotFoundError|SyntaxError|ImportError|No module named|stderr/i.test(sample)) {
      return "运行 Python 脚本或内联代码";
    }
    if (
      /__pycache__|site-packages|\/tmp\/hermes|\.py(\s|\\n|$)/i.test(sample) ||
      (/\\n.*\.(py|json|txt|md)\b/i.test(sample) && sample.length > 30)
    ) {
      return "收集命令或脚本的标准输出与结果路径";
    }
  }

  /** 仅有 `status`+`output`（无 exit_code）常见于 execute / 终端工具成功回包 */
  if (hasStatus && outStr.trim()) {
    const sl = String(inner.status).trim().toLowerCase();
    if (sl === "success" || sl === "ok") {
      const o = collapseWs(outStr);
      if (/\.json\b/i.test(o) && /sessions|session_|\/opt\/data|mineru|content_list|parsed/i.test(o)) {
        return "拉取会话或解析流程产出的 JSON 结果文件";
      }
      if (/\.json\b/i.test(o)) return "读取工具输出的 JSON 结果文件";
      if (/\d+\s*bytes?\b/i.test(o) && /[\w.-]+\.(json|txt|md|pdf|csv)\b/i.test(o)) {
        return "确认工具写入的结果文件路径与大小";
      }
      return "收集命令或脚本的标准输出与结果路径";
    }
    if (sl === "error") {
      if (/ModuleNotFoundError|ImportError|Traceback|SyntaxError|No module named|File "\/tmp\//i.test(outStr)) {
        return "运行 Python 脚本或内联代码";
      }
      return "在用户环境中执行脚本或 shell 命令";
    }
  }

  if (hasEc && !hasStatus) {
    const ec = inner.exit_code as number;
    if (!outStr.trim() && ec === -1) {
      const err = typeof inner.error === "string" ? inner.error : "";
      if (/approval|用户确认|⚠️|受限|sandbox/i.test(err)) return "在用户环境中发起需确认的 shell 命令";
    }
    if (!outStr.trim()) {
      if (ec !== 0) {
        return "在用户环境中执行 shell 命令";
      }
      return null;
    }
    if (/Traceback|SyntaxError:/i.test(outStr)) return "运行 Python 脚本或内联代码";
    if (ec === -1) {
      const err = typeof inner.error === "string" ? inner.error : "";
      if (/approval|用户确认|⚠️|受限|sandbox/i.test(err + outStr)) return "在用户环境中发起需确认的 shell 命令";
    }
    if (ec === 0 && /CONNECTION OK|=== SCHEMA ===|ROW_COUNT:/i.test(outStr)) {
      return "检测数据库连通性并拉取表结构信息";
    }
    if (ec === 0 && /->\s*(OK|FAIL)/i.test(outStr)) {
      return "检测目标主机端口的连通性";
    }
    if (ec === 0 && /Using Python|Checked \d+\s+package|uv pip|pip install/i.test(outStr)) {
      return "检查或安装 Python 依赖与虚拟环境";
    }
    if (ec === 0 && /\.venv\/bin\/python|\/tmp\/[^\s]+\/bin\/python/i.test(outStr)) {
      return "探测当前环境中可用的 Python 解释器路径";
    }
    if (ec !== 0) {
      return "在用户环境中执行 shell 命令";
    }
    if (/curl|wget|minio|aws|s3|http:\/\//i.test(outStr)) return "通过命令行发起网络或对象存储请求";
    if (/mysql|pymysql|schema|SELECT/i.test(outStr)) return "执行与数据库相关的脚本或客户端命令";
    return "在用户环境中执行 shell 命令并收集标准输出";
  }

  return null;
}

/**
 * Hermes 等上游常把工具输出包在 `[{ "type":"input_text", "text":"..." }]` 里，
 * `text` 内再嵌一层 JSON。胶囊只写「在做什么」，不写成败与 stderr。
 */
function normHermesPartType(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * 外层 `[{type,text}]` 或内层 `text` 因 SSE 截断导致 `JSON.parse` 失败时，用正则从原文抓
 * `status: success` + `output` 路径，避免胶囊退化成整段 `[{"type":…`。
 */
function tryLooseHermesShellSuccessBlob(blob: string): string | null {
  const b = normalizeJsonLikeAsciiQuotes(blob);
  if (!b.trim()) return null;
  const looksHermesEnvelope =
    /^\s*\[\s*\{/.test(b) ||
    /"type"\s*:\s*"(?:input_text|output_text|INPUT_TEXT|OUTPUT_TEXT)"/i.test(b) ||
    /\\"type\\"\s*:\s*\\"(?:input_text|output_text)\\"/i.test(b);
  if (!looksHermesEnvelope) return null;
  const hasSuccess =
    /"status"\s*:\s*"success"/i.test(b) ||
    /"status"\s*:\s*'success'/i.test(b) ||
    /\\"status\\"\s*:\s*\\"success\\"/i.test(b);
  if (!hasSuccess) return null;

  const outM =
    b.match(/"output"\s*:\s*"((?:[^"\\]|\\.){0,480})/) ??
    b.match(/\\"output\\"\s*:\s*\\"((?:[^"\\]|\\.){0,480})/);
  const pathFrag = outM?.[1] ? collapseWs(outM[1].replace(/\\"/g, '"').replace(/\\n/g, " ")) : "";
  const probe = pathFrag || b;

  if (/\.json\b/i.test(probe) && /sessions|session_|\/opt\/data|mineru|content_list|parsed/i.test(probe)) {
    return "拉取会话或解析流程产出的 JSON 结果文件";
  }
  if (/\.json\b/i.test(probe)) return "读取工具输出的 JSON 结果文件";
  if (/"output"\s*:\s*"/i.test(b) || /\\"output\\"\s*:\s*\\"/i.test(b)) {
    return "收集命令执行返回的结果路径或标准输出摘要";
  }
  return null;
}

export function summarizeHermesContentPartEnvelope(raw: string): string | null {
  const trimmed = normalizeJsonLikeAsciiQuotes(raw.trim());
  const arr = tryParseJsonArray(trimmed);
  if (!arr?.length) {
    const lone = tryParseObject(extractFirstJsonObject(trimmed) ?? (trimmed.startsWith("{") ? trimmed : null));
    const loneTyp = normHermesPartType(lone?.type);
    if (lone && (loneTyp === "input_text" || loneTyp === "output_text") && typeof lone.text === "string" && lone.text.trim()) {
      return summarizeHermesContentPartEnvelope(JSON.stringify([lone]));
    }
    const looseOnly = tryLooseSkillMetaSummary(trimmed);
    if (looseOnly) return looseOnly;
    const looseShell = tryLooseHermesShellSuccessBlob(trimmed);
    if (looseShell) return looseShell;
    const looseHttpTop = tryLooseHttpApiInHermesBlob(trimmed);
    if (looseHttpTop) return looseHttpTop;
    const looseEnvTop = tryLooseHermesEnvelopeHeuristic(trimmed);
    if (looseEnvTop) return looseEnvTop;
    return null;
  }
  const first = arr?.[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const o = first as Record<string, unknown>;
  const typ = normHermesPartType(o.type);
  const text = typeof o.text === "string" ? o.text : "";
  if (!text.trim()) return null;
  if (typ && typ !== "input_text" && typ !== "output_text") return null;

  const textBody = peelChainedResultJsonStrings(text.trim());

  const innerSlice =
    extractFirstJsonObject(textBody) ?? (textBody.startsWith("{") ? textBody : null);
  const inner = tryParseObject(innerSlice);
  if (!inner && textBody.includes('"error"')) {
    const errM = textBody.match(/"error"\s*:\s*"((?:[^"\\]|\\.){0,400})"/);
    if (errM?.[1]) {
      const er = collapseWs(errM[1].replace(/\\"/g, '"').replace(/\\n/g, " "));
      if (/Method not found|McpError|MCP call failed/i.test(er)) return "调用 MCP 或托管工具接口";
      return "调用上游工具服务";
    }
  }
  if (!inner && textBody.trim()) {
    const looseInner = tryLooseHermesShellSuccessBlob(textBody);
    if (looseInner) return looseInner;
    const looseHttpText = tryLooseHttpApiInHermesBlob(textBody);
    if (looseHttpText) return looseHttpText;
    const looseEnvInner = tryLooseHermesEnvelopeHeuristic(textBody);
    if (looseEnvInner) return looseEnvInner;
  }
  if (inner) {
    const nm = typeof inner.name === "string" ? inner.name.trim() : "";
    const skOk = inner.success === true || inner.success === 1;
    const skDesc = typeof inner.description === "string" ? inner.description.trim() : "";
    if (nm && skOk) {
      const descShort = skDesc ? collapseWs(skDesc).slice(0, 80) : "";
      return descShort
        ? `载入技能「${nm}」说明：${descShort}${skDesc.length > 80 ? "…" : ""}`
        : `载入技能「${nm}」的元数据`;
    }
    if (nm && inner.success === false) {
      return `请求加载技能「${nm}」的配置与资源`;
    }

    const toolLine = summarizeToolInnerWithResultPeeling(inner);
    if (toolLine) return toolLine;

    if (typeof inner.status === "string") {
      const st = inner.status.trim().toLowerCase();
      if (st === "error" || st === "success") {
        return "在用户环境中执行脚本或 shell 命令";
      }
    }
    if (typeof inner.exit_code === "number" && inner.exit_code !== 0) {
      return "在用户环境中执行 shell 命令";
    }
    if (typeof inner.command === "string" && inner.command.trim()) {
      return "执行已下发的 shell 命令行";
    }
  }

  const looseHttpFromText = tryLooseHttpApiInHermesBlob(textBody);
  if (looseHttpFromText) return looseHttpFromText;
  const looseEnvFromText = tryLooseHermesEnvelopeHeuristic(textBody);
  if (looseEnvFromText) return looseEnvFromText;

  const blob = collapseWs(textBody);
  if (/Method not found/i.test(blob) && /McpError|MCP/i.test(blob)) {
    return "调用 MCP 或托管工具接口";
  }
  if (/MCP call failed/i.test(blob) && /"error"\s*:/i.test(blob)) {
    return "调用 MCP 或托管工具接口";
  }
  if (/pymysql|ModuleNotFoundError|No module named/i.test(blob)) {
    return "准备运行依赖数据库的 Python 代码";
  }
  if (/externally-managed-environment/i.test(blob)) {
    return "准备调整 Python 环境以满足依赖安装策略";
  }
  if (/Can't connect to MySQL|ECONNREFUSED|2003\s*\(/i.test(blob)) {
    return "尝试与 MySQL 建立网络连接";
  }
  if (/Access denied|1045/i.test(blob)) {
    return "使用配置的账号向 MySQL 发起鉴权";
  }
  if (/Traceback|SyntaxError:/i.test(blob)) {
    return "运行 Python 脚本或内联代码";
  }
  if (/virtualenv|venv|pip\s+install/i.test(blob)) {
    return "创建或切换虚拟环境并安装依赖包";
  }
  if (/shell command via|⚠️.*-c\//i.test(blob)) {
    return "通过受限 shell 执行命令行片段";
  }

  const looseSkill = tryLooseSkillMetaSummary(blob);
  if (looseSkill) return looseSkill;

  return typ === "output_text" ? "输出助手中间结果或封装块" : "写入本轮工具调用的返回载荷";
}

/** 从工具返回 JSON 推断「（n 项）」后缀 */
export function tryItemCountSuffix(detail: string, outputPreview?: string): string | null {
  for (const blob of [outputPreview, detail]) {
    if (!blob?.trim()) continue;
    const slice =
      extractFirstJsonObject(blob) ?? (blob.trim().startsWith("{") ? blob.trim() : null);
    if (!slice) continue;
    const o = tryParseObject(slice);
    if (!o) continue;
    if (typeof o.total_count === "number") return `（${o.total_count} 项）`;
    if (Array.isArray(o.items)) return `（${o.items.length} 项）`;
    if (Array.isArray(o.files)) return `（${o.files.length} 项）`;
    if (Array.isArray(o.entries)) return `（${o.entries.length} 项）`;
    if (Array.isArray(o.results)) return `（${o.results.length} 项）`;
  }
  return null;
}

/**
 * 将 skill_view 等大型 JSON 压成一行中文；并覆盖 list_dir / read_file 等常见形态。
 */
export function summarizeJsonBlobForPill(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > UI_HEURISTIC_SCAN_MAX) {
    return "处理较大的工具返回载荷（正文已截断展示）";
  }
  const normalizedRaw = normalizeJsonLikeAsciiQuotes(trimmed);
  const s = collapseWs(normalizedRaw);
  if (!s) return s;

  const envelope = summarizeHermesContentPartEnvelope(normalizedRaw);
  if (envelope) return envelope;

  const looseHttpRaw = tryLooseHttpApiInHermesBlob(normalizedRaw);
  if (looseHttpRaw) return looseHttpRaw;
  const looseEnvRaw = tryLooseHermesEnvelopeHeuristic(normalizedRaw);
  if (looseEnvRaw) return looseEnvRaw;

  const looseShellTop = tryLooseHermesShellSuccessBlob(normalizedRaw);
  if (looseShellTop) return looseShellTop;

  const jsonSlice = extractFirstJsonObject(normalizedRaw) ?? extractFirstJsonObject(s);
  const o = tryParseObject(jsonSlice) ?? (/^\{/.test(s) ? tryParseObject(s.trim()) : null);

  if (o) {
    const envelopeOne = summarizeHermesContentPartEnvelope(JSON.stringify([o]));
    if (envelopeOne) return envelopeOne;

    if (o.status === "error" || o.status === "success") {
      return "在用户环境中执行脚本或 shell 命令";
    }

    const flatTool = summarizeToolInnerWithResultPeeling(o);
    if (flatTool) return flatTool;

    const path =
      typeof o.path === "string"
        ? o.path.trim()
        : typeof o.file_path === "string"
          ? o.file_path.trim()
          : typeof o.target_file === "string"
            ? o.target_file.trim()
            : "";
    if (Array.isArray(o.entries)) {
      return path ? "浏览目录并列出其中的子项" : "列出目录下的文件与子目录";
    }
    if (path && (typeof o.content === "string" || typeof o.lines === "string")) {
      return "读取指定路径下的文件正文";
    }
    if (typeof o.command === "string" && o.command.trim()) {
      return "执行已下发的 shell 命令行";
    }
    if (typeof o.stdout === "string" && o.stdout.trim()) {
      return "读取子进程的终端标准输出";
    }

    const name = typeof o.name === "string" ? o.name.trim() : "";
    const success = o.success;
    const error = typeof o.error === "string" ? o.error.trim() : "";
    const hasSkillShape =
      Boolean(name) &&
      success !== false &&
      (success === true || success === 1 || typeof o.description === "string" || Array.isArray(o.tags));
    if (hasSkillShape) {
      const desc =
        typeof o.description === "string" ? collapseWs(o.description).slice(0, 140) : "";
      return desc
        ? `载入技能「${name}」说明：${desc.slice(0, 120)}${desc.length > 120 ? "…" : ""}`
        : `载入技能「${name}」的元数据`;
    }
    if (name && success === false) {
      return `请求加载技能「${name}」的配置与资源`;
    }
    if (success === true) {
      return "拉取结构化 JSON 载荷供后续步骤使用";
    }
    if (success === false) {
      return "调用上游接口并等待其返回";
    }
    const keys = Object.keys(o);
    if (keys.length) {
      if (keys.length <= 4 && keys.every((k) => ["type", "text", "index", "id"].includes(k))) {
        const t = typeof o.text === "string" ? o.text : "";
        const fromText = t.trim() ? summarizeJsonBlobForPill(t) : null;
        if (fromText && !/^读取结构化数据对象/.test(fromText)) return fromText;
      }
      const hint = keys.slice(0, 4).join("、") + (keys.length > 4 ? "…" : "");
      return `读取结构化数据对象（${hint}）`;
    }
  }

  if (jsonSlice && jsonSlice.length > 120) {
    return "传输一段结构化 JSON 载荷";
  }
  if (!/^\{/.test(s)) return s.length > 260 ? `${s.slice(0, 260)}…` : s;
  return s.length > 260 ? `${s.slice(0, 260)}…` : s;
}
