import { NextResponse } from "next/server";
import { fetchTimeoutSignal } from "@/lib/fetch-timeout-signal";

type TestRequestBody = {
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
};

/** BFF 出站探测超时（毫秒）；可通过环境变量覆盖 */
const MODEL_TEST_TIMEOUT_MS = Math.max(
  15_000,
  Number.parseInt(process.env.MODEL_TEST_TIMEOUT_MS ?? "45000", 10) || 45_000,
);

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function resolveTestEndpoint(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/chat/completions`;
}

function formatProviderHint(status: number, brief: string, provider: string): string | null {
  const p = provider.toLowerCase();
  if (status === 402 || /insufficient balance/i.test(brief)) {
    return "DeepSeek 等平台返回 402 通常表示账户余额不足，请到厂商控制台充值或更换 API Key。";
  }
  if (status === 401 || /authentication|invalid.*api key/i.test(brief)) {
    return "请确认 API Key 正确、未过期，且与当前接口地址（厂商/区域）匹配。";
  }
  if (status === 404 || /model.*not found|does not exist/i.test(brief)) {
    return "请核对模型名称是否与厂商文档一致（如 deepseek-v4-flash，注意大小写）。";
  }
  if (p.includes("deepseek") && status === 0) {
    return null;
  }
  return null;
}

function formatFetchError(error: unknown, latencyMs: number): string {
  if (error instanceof Error && error.name === "AbortError") {
    return `连接超时（${latencyMs}ms，上限 ${MODEL_TEST_TIMEOUT_MS}ms）。请检查：① 本机/服务器能否访问外网（如 api.deepseek.com）；② 公司代理是否需配置 HTTP_PROXY；③ 接口地址是否为 https://api.deepseek.com；④ 账户余额是否充足。`;
  }
  const msg = error instanceof Error ? error.message : "未知错误";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return `网络不可达（${latencyMs}ms）：${msg}。请确认运行 Next 的环境能访问外网，或配置系统/环境变量 HTTP_PROXY。`;
  }
  return `连接失败：${msg}`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as TestRequestBody;
  const provider = body.provider?.trim() ?? "";
  const modelName = body.modelName?.trim() ?? "";
  const baseUrl = body.baseUrl?.trim() ?? "";
  const apiKey = body.apiKey?.trim() ?? "";

  if (!modelName || !baseUrl || !apiKey) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "缺少必填项：模型名称、接口地址或接口密钥。",
      },
      { status: 400 },
    );
  }

  const start = Date.now();

  try {
    const endpoint = resolveTestEndpoint(baseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        max_tokens: 1,
      }),
      signal: fetchTimeoutSignal(MODEL_TEST_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;
    const text = await response.text();
    const brief = text.slice(0, 180);

    if (!response.ok) {
      const hint = formatProviderHint(response.status, brief, provider);
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          latencyMs,
          message: `连接失败（HTTP ${response.status}）。${brief || "请检查 Base URL、API Key、模型名是否正确。"}${hint ? ` ${hint}` : ""}`,
          provider,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: "success",
      latencyMs,
      message: `连接成功（${latencyMs}ms）`,
      provider,
    });
  } catch (error) {
    const latencyMs = Date.now() - start;
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        latencyMs,
        message: formatFetchError(error, latencyMs),
        provider,
      },
      { status: 200 },
    );
  }
}

