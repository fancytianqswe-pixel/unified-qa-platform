#!/usr/bin/env node
/**
 * stdio MCP：对已运行的 MinerU FastAPI（`mineru-api`，默认 http://127.0.0.1:8000）
 * 封装其 HTTP 路由：/health、/file_parse、/tasks、/tasks/{id}、/tasks/{id}/result。
 *
 * 环境变量：
 * - MINERU_API_BASE_URL：API 根地址，默认 http://127.0.0.1:8000
 * - MINERU_API_ALLOWED_READ_PREFIX：可选；若设置，仅允许读取该前缀下的 filePath
 * - MINERU_API_DEFAULT_BACKEND：未在工具参数中指定 backend 时使用；不设则 MCP 默认传 **pipeline**（仅 pipeline 权重环境安全）。已装 VLM/hybrid 时可设为 hybrid-auto-engine 等。
 * - MINERU_POLL_INTERVAL_MS：mineru_api_parse_and_wait 轮询间隔，默认 5000
 * - MINERU_POLL_MAX_WAIT_MS：单任务最长等待，默认 7200000（2 小时）
 * - MINERU_PARSE_MAX_RETRIES：失败或 HTTP 异常时最多重试提交次数，默认 3
 * - MINERU_PARSE_RETRY_DELAY_MS：重试前等待，默认 5000
 *
 * 上游文档：https://github.com/opendatalab/MinerU
 */
import { readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const baseUrl = () => (process.env.MINERU_API_BASE_URL?.trim() || "http://127.0.0.1:8000").replace(/\/$/, "");

const allowedPrefix = (): string | undefined => {
  const p = process.env.MINERU_API_ALLOWED_READ_PREFIX?.trim();
  return p || undefined;
};

function assertPathAllowed(absPath: string): void {
  const prefix = allowedPrefix();
  if (!prefix) return;
  const child = resolve(absPath);
  const root = resolve(prefix);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (child !== root && !child.startsWith(rootWithSep)) {
    throw new Error(`filePath 不在 MINERU_API_ALLOWED_READ_PREFIX 下：${root}`);
  }
}

const MAX_SYNC_BODY_CHARS = 400_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function pollIntervalMs(): number {
  return parsePositiveInt(process.env.MINERU_POLL_INTERVAL_MS, 5_000);
}

function pollMaxWaitMs(): number {
  return parsePositiveInt(process.env.MINERU_POLL_MAX_WAIT_MS, 7_200_000);
}

function parseMaxRetries(): number {
  return parsePositiveInt(process.env.MINERU_PARSE_MAX_RETRIES, 3);
}

function parseRetryDelayMs(): number {
  return parsePositiveInt(process.env.MINERU_PARSE_RETRY_DELAY_MS, 5_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (o.body && typeof o.body === "object" && !Array.isArray(o.body)) {
    return o.body as Record<string, unknown>;
  }
  return o;
}

function extractTaskStatus(body: unknown): string {
  const o = unwrapRecord(body);
  const s = o?.status;
  return typeof s === "string" ? s.trim().toLowerCase() : "unknown";
}

function extractTaskId(body: unknown): string | null {
  const o = unwrapRecord(body);
  const id = o?.task_id ?? o?.taskId;
  return typeof id === "string" && id.trim().length >= 8 ? id.trim() : null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ httpStatus: number; body: unknown; text: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text };
  }
  return { httpStatus: res.status, body, text };
}

const backendEnum = z.enum([
  "pipeline",
  "vlm-http-client",
  "hybrid-http-client",
  "vlm-auto-engine",
  "hybrid-auto-engine",
]);

/** 与 MinerU `parse_request_form` 对齐的表单字段（除 files 外） */
const parseOptionsSchema = z.object({
  langList: z.array(z.string()).optional().describe('语言列表，默认 ["ch"]；对应 Form lang_list'),
  backend: backendEnum.optional(),
  parseMethod: z.enum(["auto", "txt", "ocr"]).optional(),
  formulaEnable: z.boolean().optional(),
  tableEnable: z.boolean().optional(),
  imageAnalysis: z.boolean().optional().describe("VLM/hybrid 后端时的图像/图表分析"),
  serverUrl: z.string().optional().describe("*-http-client 后端时需要的 OpenAI 兼容地址"),
  returnMd: z.boolean().optional(),
  returnMiddleJson: z.boolean().optional(),
  returnContentList: z.boolean().optional(),
  returnImages: z.boolean().optional(),
  responseFormatZip: z.boolean().optional(),
  startPageId: z.number().int().min(0).optional(),
  endPageId: z.number().int().min(0).optional(),
});

const fileParseSchema = parseOptionsSchema.extend({
  filePath: z
    .string()
    .describe(
      "本机可读文件的绝对路径；MCP 进程将读取该文件并以 multipart 上传（与 MinerU /file_parse、/tasks 一致）。",
    ),
});

const taskIdSchema = z.object({
  taskId: z.string().min(8).describe("异步任务 ID（由 POST /tasks 返回的 task_id）"),
});

function defaultBackend(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.MINERU_API_DEFAULT_BACKEND?.trim();
  if (fromEnv) return fromEnv;
  // 与常见「仅 pipeline 权重」联调一致；需 hybrid/VLM 时请设 MINERU_API_DEFAULT_BACKEND 或工具参数 backend。
  return "pipeline";
}

function appendParseFormFields(form: FormData, fileName: string, buf: Buffer, args: z.infer<typeof parseOptionsSchema>): void {
  form.append("files", new Blob([buf as BlobPart]), fileName);
  const langs = args.langList?.length ? args.langList : ["ch"];
  for (const lang of langs) {
    form.append("lang_list", lang);
  }
  form.append("backend", defaultBackend(args.backend));
  form.append("parse_method", args.parseMethod ?? "auto");
  form.append("formula_enable", String(args.formulaEnable ?? true));
  form.append("table_enable", String(args.tableEnable ?? true));
  form.append("image_analysis", String(args.imageAnalysis ?? true));
  if (args.serverUrl) form.append("server_url", args.serverUrl);
  form.append("return_md", String(args.returnMd ?? true));
  form.append("return_middle_json", String(args.returnMiddleJson ?? false));
  form.append("return_model_output", "false");
  form.append("return_content_list", String(args.returnContentList ?? false));
  form.append("return_images", String(args.returnImages ?? false));
  form.append("response_format_zip", String(args.responseFormatZip ?? false));
  form.append("return_original_file", "false");
  form.append("start_page_id", String(args.startPageId ?? 0));
  form.append("end_page_id", String(args.endPageId ?? 99999));
}

async function readLocalFileForUpload(filePath: string): Promise<{ abs: string; buf: Buffer; name: string }> {
  const abs = resolve(filePath);
  assertPathAllowed(abs);
  const buf = await readFile(abs);
  return { abs, buf, name: basename(abs) };
}

function jsonToolResult(obj: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}

/** SDK 仅在注册过 prompt/resource 时才挂 `prompts/list`、`resources/list`；仅工具型 MCP 若不挂会返回 JSON-RPC Method not found，Hermes 界面显示「方法未找到」。connect 前挂空列表 handler（SDK 方法为 private，运行时存在）。 */
function attachEmptyPromptAndResourceHandlers(mcp: McpServer): void {
  const m = mcp as unknown as {
    setPromptRequestHandlers(): void;
    setResourceRequestHandlers(): void;
  };
  m.setPromptRequestHandlers();
  m.setResourceRequestHandlers();
}

const server = new McpServer({
  name: "xingyan-mineru-api-mcp",
  version: "1.0.0",
});

server.registerTool(
  "mineru_api_health",
  {
    description: "GET /health：确认 mineru-api 与任务管理器可用。",
    inputSchema: z.object({}),
  },
  async () => {
    const url = `${baseUrl()}/health`;
    try {
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { _raw: text };
      }
      return jsonToolResult({ httpStatus: res.status, url, body });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonToolResult({
        ok: false,
        url,
        error: msg,
        hint: "请先启动 `mineru-api` 并设置 MINERU_API_BASE_URL。",
      });
    }
  },
);

server.registerTool(
  "mineru_api_sync_parse",
  {
    description:
      "POST /file_parse：同步上传（小文件/联调用）。大 PDF/Office 请用 mineru_api_parse_and_wait，避免长连接中断。",
    inputSchema: fileParseSchema,
  },
  async (args) => {
    let buf: Buffer;
    let name: string;
    try {
      ({ buf, name } = await readLocalFileForUpload(args.filePath));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonToolResult({ ok: false, error: `readFile: ${msg}` });
    }

    const form = new FormData();
    appendParseFormFields(form, name, buf, args);

    const url = `${baseUrl()}/file_parse`;
    try {
      const res = await fetch(url, { method: "POST", body: form });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { _raw: text };
      }
      const serialized = JSON.stringify({ httpStatus: res.status, url, body: parsed });
      const out =
        serialized.length > MAX_SYNC_BODY_CHARS
          ? `${serialized.slice(0, MAX_SYNC_BODY_CHARS)}\n…(truncated; 缩小返回字段或启用 response_format_zip)`
          : serialized;
      return { content: [{ type: "text" as const, text: out }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonToolResult({ ok: false, url, error: msg });
    }
  },
);

async function submitParseTask(
  args: z.infer<typeof fileParseSchema>,
): Promise<
  | { ok: true; taskId: string; httpStatus: number; submitBody: unknown }
  | { ok: false; httpStatus?: number; error: string; submitBody?: unknown }
> {
  let buf: Buffer;
  let name: string;
  try {
    ({ buf, name } = await readLocalFileForUpload(args.filePath));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `readFile: ${msg}` };
  }

  const form = new FormData();
  appendParseFormFields(form, name, buf, args);

  const url = `${baseUrl()}/tasks`;
  try {
    const { httpStatus, body } = await fetchJson(url, { method: "POST", body: form });
    const taskId = extractTaskId(body);
    if ((httpStatus === 202 || httpStatus === 200) && taskId) {
      return { ok: true, taskId, httpStatus, submitBody: body };
    }
    if (httpStatus === 409) {
      return {
        ok: false,
        httpStatus,
        error: "MinerU 并发已满（409），请稍后重试或减少并行解析数",
        submitBody: body,
      };
    }
    return {
      ok: false,
      httpStatus,
      error: `提交异步任务失败（HTTP ${httpStatus}）`,
      submitBody: body,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function queryTaskStatus(taskId: string): Promise<{
  httpStatus: number;
  status: string;
  body: unknown;
}> {
  const url = `${baseUrl()}/tasks/${encodeURIComponent(taskId)}`;
  const { httpStatus, body } = await fetchJson(url, { method: "GET" });
  return { httpStatus, status: extractTaskStatus(body), body };
}

async function fetchTaskResult(taskId: string): Promise<{
  httpStatus: number;
  body: unknown;
  text: string;
}> {
  const url = `${baseUrl()}/tasks/${encodeURIComponent(taskId)}/result`;
  return fetchJson(url, { method: "GET" });
}

server.registerTool(
  "mineru_api_submit_parse_task",
  {
    description:
      "POST /tasks：异步提交解析，立即返回 202 与 task_id；大文件请优先 mineru_api_parse_and_wait（内置轮询与重试）。",
    inputSchema: fileParseSchema,
  },
  async (args) => {
    const submitted = await submitParseTask(args);
    if (!submitted.ok) {
      return jsonToolResult(submitted);
    }
    return jsonToolResult({
      httpStatus: submitted.httpStatus,
      url: `${baseUrl()}/tasks`,
      body: submitted.submitBody,
      task_id: submitted.taskId,
    });
  },
);

server.registerTool(
  "mineru_api_parse_and_wait",
  {
    description:
      "推荐：POST /tasks 后由 MCP 进程内轮询状态直至 completed/failed；失败或网络异常时自动重试提交（次数见 MINERU_PARSE_MAX_RETRIES）。避免同步 /file_parse 长连接与 Hermes 内手写 Python 调 API。",
    inputSchema: fileParseSchema,
  },
  async (args) => {
    const maxRetries = parseMaxRetries();
    const retryDelayMs = parseRetryDelayMs();
    const intervalMs = pollIntervalMs();
    const maxWaitMs = pollMaxWaitMs();
    const attempts: Array<Record<string, unknown>> = [];
    let lastTaskId: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const submitted = await submitParseTask(args);
      if (!submitted.ok) {
        attempts.push({ attempt, phase: "submit", ok: false, error: submitted.error, httpStatus: submitted.httpStatus });
        if (attempt < maxRetries) {
          await sleep(retryDelayMs);
          continue;
        }
        return jsonToolResult({
          ok: false,
          filePath: args.filePath,
          attempts,
          error: submitted.error,
        });
      }

      lastTaskId = submitted.taskId;
      const started = Date.now();
      let lastStatus = "pending";
      let shouldRetryAttempt = false;
      const pollLog: Array<{ atMs: number; status: string; httpStatus: number }> = [];

      while (Date.now() - started < maxWaitMs) {
        let statusPayload: { httpStatus: number; status: string; body: unknown };
        try {
          statusPayload = await queryTaskStatus(lastTaskId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pollLog.push({ atMs: Date.now() - started, status: "poll_error", httpStatus: 0 });
          if (attempt < maxRetries) {
            attempts.push({ attempt, phase: "poll", ok: false, taskId: lastTaskId, error: msg, pollLog });
            shouldRetryAttempt = true;
            await sleep(retryDelayMs);
            break;
          }
          return jsonToolResult({ ok: false, taskId: lastTaskId, attempts, error: `轮询异常: ${msg}`, pollLog });
        }

        lastStatus = statusPayload.status;
        pollLog.push({
          atMs: Date.now() - started,
          status: lastStatus,
          httpStatus: statusPayload.httpStatus,
        });

        if (lastStatus === "completed") {
          try {
            const result = await fetchTaskResult(lastTaskId);
            const serialized = JSON.stringify({
              ok: true,
              taskId: lastTaskId,
              attempt,
              waitedMs: Date.now() - started,
              pollLog,
              httpStatus: result.httpStatus,
              body: result.body,
            });
            const out =
              serialized.length > MAX_SYNC_BODY_CHARS
                ? `${serialized.slice(0, MAX_SYNC_BODY_CHARS)}\n…(truncated)`
                : serialized;
            return { content: [{ type: "text" as const, text: out }] };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (attempt < maxRetries) {
              attempts.push({ attempt, phase: "result", ok: false, taskId: lastTaskId, error: msg, pollLog });
              shouldRetryAttempt = true;
              await sleep(retryDelayMs);
              break;
            }
            return jsonToolResult({ ok: false, taskId: lastTaskId, attempts, error: `拉取结果失败: ${msg}`, pollLog });
          }
        }

        if (lastStatus === "failed") {
          attempts.push({
            attempt,
            phase: "mineru_failed",
            ok: false,
            taskId: lastTaskId,
            statusBody: statusPayload.body,
            pollLog,
          });
          if (attempt < maxRetries) {
            shouldRetryAttempt = true;
            await sleep(retryDelayMs);
            break;
          }
          return jsonToolResult({
            ok: false,
            taskId: lastTaskId,
            attempts,
            error: "MinerU 任务状态为 failed，已达最大重试次数",
            lastStatusBody: statusPayload.body,
          });
        }

        await sleep(intervalMs);
      }

      if (shouldRetryAttempt) {
        continue;
      }

      if (Date.now() - started >= maxWaitMs) {
        attempts.push({
          attempt,
          phase: "timeout",
          ok: false,
          taskId: lastTaskId,
          waitedMs: Date.now() - started,
          lastStatus,
          pollLog,
        });
        if (attempt < maxRetries) {
          await sleep(retryDelayMs);
          continue;
        }
        return jsonToolResult({
          ok: false,
          taskId: lastTaskId,
          attempts,
          error: `轮询超时（>${Math.round(maxWaitMs / 60_000)} 分钟），最后状态: ${lastStatus}`,
        });
      }
    }

    return jsonToolResult({
      ok: false,
      taskId: lastTaskId,
      attempts,
      error: "未能在重试次数内完成解析",
    });
  },
);

server.registerTool(
  "mineru_api_task_status",
  {
    description: "GET /tasks/{task_id}：查询异步解析任务状态。",
    inputSchema: taskIdSchema,
  },
  async ({ taskId }) => {
    const url = `${baseUrl()}/tasks/${encodeURIComponent(taskId)}`;
    try {
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { _raw: text };
      }
      return jsonToolResult({ httpStatus: res.status, url, body });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonToolResult({ ok: false, url, error: msg });
    }
  },
);

server.registerTool(
  "mineru_api_task_result",
  {
    description: "GET /tasks/{task_id}/result：获取已完成任务的解析结果（JSON 可能很大，超长会截断）。",
    inputSchema: taskIdSchema,
  },
  async ({ taskId }) => {
    const url = `${baseUrl()}/tasks/${encodeURIComponent(taskId)}/result`;
    try {
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { _raw: text };
      }
      const serialized = JSON.stringify({ httpStatus: res.status, url, body: parsed });
      const out =
        serialized.length > MAX_SYNC_BODY_CHARS
          ? `${serialized.slice(0, MAX_SYNC_BODY_CHARS)}\n…(truncated)`
          : serialized;
      return { content: [{ type: "text" as const, text: out }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonToolResult({ ok: false, url, error: msg });
    }
  },
);

attachEmptyPromptAndResourceHandlers(server);

const transport = new StdioServerTransport();
await server.connect(transport);
