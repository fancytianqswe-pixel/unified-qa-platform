#!/usr/bin/env node
/**
 * stdio MCP：在本机已安装 MinerU CLI（`mineru`，见 PyPI `mineru` 包）时，将「本地解析」能力暴露给 Hermes / Cursor。
 *
 * 环境变量：
 * - MINERU_EXECUTABLE：可执行名或绝对路径，默认 `mineru`
 * - MINERU_CLI_TIMEOUT_MS：单次解析超时（毫秒），不设则由 Node 默认（无上限）
 *
 * 上游文档：https://github.com/opendatalab/MinerU
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const executable = () => process.env.MINERU_EXECUTABLE?.trim() || "mineru";
const timeoutMs = () => {
    const raw = process.env.MINERU_CLI_TIMEOUT_MS?.trim();
    if (!raw)
        return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};
const backendEnum = z.enum([
    "pipeline",
    "vlm-http-client",
    "hybrid-http-client",
    "vlm-auto-engine",
    "hybrid-auto-engine",
]);
const langEnum = z.enum([
    "ch",
    "ch_server",
    "ch_lite",
    "en",
    "korean",
    "japan",
    "chinese_cht",
    "ta",
    "te",
    "ka",
    "th",
    "el",
    "latin",
    "arabic",
    "east_slavic",
    "cyrillic",
    "devanagari",
]);
const parseSchema = z.object({
    inputPath: z.string().describe("本地文件或目录的绝对路径（PDF/图片/DOCX/PPTX/XLSX 等，与 MinerU CLI -p 一致）"),
    outputDir: z.string().describe("输出目录绝对路径（MinerU 会写入 Markdown/JSON 等，与 CLI -o 一致）"),
    method: z.enum(["auto", "txt", "ocr"]).optional().describe("PDF 解析方式；默认 auto"),
    backend: backendEnum.optional().describe("推理后端；默认 hybrid-auto-engine"),
    lang: langEnum.optional().describe("语言包；默认 ch"),
    serverUrl: z.string().optional().describe("当 backend 为 *-http-client 时必填的 OpenAI 兼容服务地址"),
    apiUrl: z.string().optional().describe("若已常驻 mineru-api，可指定其 base URL，避免 CLI 临时拉起服务"),
    startPageId: z.number().int().min(0).optional().describe("PDF 起始页（从 0 计）"),
    endPageId: z.number().int().min(0).optional().describe("PDF 结束页（从 0 计）"),
    formulaEnable: z.boolean().optional().describe("是否解析公式"),
    tableEnable: z.boolean().optional().describe("是否解析表格"),
    extraCliArgs: z.array(z.string()).optional().describe("透传给 mineru 的额外参数（高级用法）"),
});
function buildMineruArgs(args) {
    const a = ["-p", args.inputPath, "-o", args.outputDir];
    if (args.method)
        a.push("-m", args.method);
    if (args.backend)
        a.push("-b", args.backend);
    if (args.lang)
        a.push("-l", args.lang);
    if (args.serverUrl)
        a.push("-u", args.serverUrl);
    if (args.apiUrl)
        a.push("--api-url", args.apiUrl);
    if (args.startPageId !== undefined)
        a.push("-s", String(args.startPageId));
    if (args.endPageId !== undefined)
        a.push("-e", String(args.endPageId));
    if (args.formulaEnable !== undefined)
        a.push("-f", String(args.formulaEnable));
    if (args.tableEnable !== undefined)
        a.push("-t", String(args.tableEnable));
    if (args.extraCliArgs?.length)
        a.push(...args.extraCliArgs);
    return a;
}
/** 见 mineru-api-mcp：`attachEmptyPromptAndResourceHandlers`。 */
function attachEmptyPromptAndResourceHandlers(mcp) {
    const m = mcp;
    m.setPromptRequestHandlers();
    m.setResourceRequestHandlers();
}
const server = new McpServer({
    name: "xingyan-mineru-local-mcp",
    version: "1.0.0",
});
server.registerTool("mineru_local_health", {
    description: "检查本机是否可调用 MinerU CLI：执行 `MINERU_EXECUTABLE --version`（或等价）。未安装时请按 MinerU 官方文档安装 `pip install mineru[...]` 并保证 PATH。",
    inputSchema: z.object({}),
}, async () => {
    const cmd = executable();
    const t = timeoutMs();
    try {
        const r = await execFileAsync(cmd, ["--version"], {
            encoding: "utf8",
            maxBuffer: 2 * 1024 * 1024,
            ...(t ? { timeout: t } : {}),
        });
        const text = [r.stdout?.trim(), r.stderr?.trim()].filter(Boolean).join("\n") || "(no output)";
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, command: cmd, output: text }) }] };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: false,
                        command: cmd,
                        error: msg,
                        hint: "请确认已安装 MinerU（https://github.com/opendatalab/MinerU），且 MINERU_EXECUTABLE 指向正确可执行文件。",
                    }),
                },
            ],
        };
    }
});
server.registerTool("mineru_local_parse", {
    description: "调用本机 `mineru` CLI 将文档解析到指定输出目录（-p/-o 及常用选项）。适合解析机与 MCP 同机、已安装完整 MinerU 与模型依赖的场景。大文件可能耗时数分钟，可设 MINERU_CLI_TIMEOUT_MS。",
    inputSchema: parseSchema,
}, async (args) => {
    const cmd = executable();
    const argv = buildMineruArgs(args);
    const t = timeoutMs();
    try {
        const r = await execFileAsync(cmd, argv, {
            encoding: "utf8",
            maxBuffer: 80 * 1024 * 1024,
            ...(t ? { timeout: t } : {}),
        });
        const out = [r.stdout?.trim(), r.stderr?.trim()].filter(Boolean).join("\n\n--- stderr ---\n") || "(no output)";
        const truncated = out.length > 200_000 ? `${out.slice(0, 200_000)}\n…(truncated)` : out;
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: true,
                        command: cmd,
                        argv,
                        exitSummary: truncated,
                        outputDir: args.outputDir,
                    }),
                },
            ],
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ok: false,
                        command: cmd,
                        argv,
                        error: msg,
                    }),
                },
            ],
        };
    }
});
attachEmptyPromptAndResourceHandlers(server);
const transport = new StdioServerTransport();
await server.connect(transport);
