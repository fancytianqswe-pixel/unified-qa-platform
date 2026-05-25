import { NextResponse } from "next/server";

type ModelConfig = {
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
};

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function resolveEndpoint(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
}

function fallbackTitle(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return (cleaned.slice(0, 14) || "当前会话").replace(/[，。！？、；：,.!?;:]/g, "");
}

function sanitizeTitle(raw: string, sourceText: string) {
  const fromModel = raw
    .replace(/[`"'「」【】\[\]]/g, "")
    .replace(/^#+\s*/g, "")
    .replace(/^(标题|会话标题)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = fromModel
    .replace(/^(你好|您好|请|麻烦|帮我)\s*/g, "")
    .replace(/(请使用|使用)\s*[\w\u4e00-\u9fa5-]+\s*(助手|模型)\s*/g, "")
    .trim();

  const finalTitle = normalized
    .replace(/[，。！？、；：,.!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);

  return finalTitle || fallbackTitle(sourceText);
}

export async function POST(request: Request) {
  const body = (await request.json()) as { text?: string; modelConfig?: ModelConfig };
  const text = body.text?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ ok: true, title: "当前会话" });
  }

  const modelConfig = body.modelConfig;
  if (!modelConfig?.modelName || !modelConfig?.baseUrl || !modelConfig?.apiKey) {
    return NextResponse.json({ ok: true, title: fallbackTitle(text) });
  }

  try {
    const endpoint = resolveEndpoint(modelConfig.baseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelConfig.modelName,
        messages: [
          {
            role: "system",
            content:
              "你是会话命名助手。请基于用户首条消息提炼一个6-14字中文标题。只输出标题本身，不要markdown符号，不要“标题：”，不要解释。",
          },
          {
            role: "user",
            content: `用户输入：${text}\n请直接输出一个简洁会话标题。`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: true, title: fallbackTitle(text) });
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const title = content ? sanitizeTitle(content, text) : fallbackTitle(text);
    return NextResponse.json({ ok: true, title });
  } catch {
    return NextResponse.json({ ok: true, title: fallbackTitle(text) });
  }
}

