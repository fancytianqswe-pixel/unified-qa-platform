import { NextResponse } from "next/server";

type ModelConfig = {
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
};

type StepPayload = {
  key: string;
  toolName?: string;
  step?: string;
  status?: string;
  /** 已截断的过程原文 */
  detail: string;
  inputPreview?: string;
  outputPreview?: string;
};

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function resolveEndpoint(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
}

function sanitizeOneLine(raw: string, fallback: string) {
  const t = raw
    .replace(/[`"'「」【】]/g, "")
    .replace(/^[-*•\d.\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const line = (t || fallback).slice(0, 120);
  return line || fallback;
}

function safeJsonParseObject(text: string): Record<string, string> | null {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    modelConfig?: ModelConfig;
    steps?: StepPayload[];
  };
  const steps = Array.isArray(body.steps) ? body.steps.slice(0, 12) : [];
  if (!steps.length) {
    return NextResponse.json({ ok: true, summaries: {} as Record<string, string> });
  }

  const modelConfig = body.modelConfig;
  if (!modelConfig?.modelName || !modelConfig?.baseUrl || !modelConfig?.apiKey) {
    return NextResponse.json({ ok: true, summaries: {} as Record<string, string> });
  }

  const userLines = steps.map((s, i) => {
    const head = `【${i + 1}】id=${s.key}\n工具/步骤: ${s.toolName || s.step || "unknown"}\n状态: ${s.status || "unknown"}`;
    const detail = (s.detail || "").slice(0, 1200);
    const inp = (s.inputPreview || "").slice(0, 600);
    const out = (s.outputPreview || "").slice(0, 600);
    return `${head}\n过程摘要素材:\n${detail}${inp ? `\n输入片段:\n${inp}` : ""}${out ? `\n输出片段:\n${out}` : ""}`;
  });

  const system =
    "你是面向最终用户的「过程步骤」文案助手。输入是多条 Agent/Hermes 执行记录，素材里常见：终端/代码执行的 JSON、MCP、HTTP、MySQL、MinIO、Python 等。\n" +
    "请为每条记录写**一句中文**（约 14–48 个字），只说明**这一步在调用什么、试图完成什么动作**（例如：向 MinIO 拉取合同 PDF、执行 shell 探测端口、查询数据源样本）。\n" +
    "不要写执行成败、不要写 stderr/退出码摘要、不要写「下一步建议你」；那些留给用户展开原文查看。\n" +
    "禁止写「已返回结构化数据」「字段 type、text」等模板句；不要 markdown、不要编号列表；不要堆砌 JSON 键名。\n" +
    "必须只输出一个 JSON 对象，键为每条记录中的 id 字符串（与输入 id= 完全一致），值为对应的一句话。";

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
          { role: "system", content: system },
          {
            role: "user",
            content: `请为下列步骤各生成一句摘要，输出纯 JSON 对象：\n\n${userLines.join("\n\n---\n\n")}`,
          },
        ],
        stream: false,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: true, summaries: {} as Record<string, string> });
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJsonParseObject(content);
    const summaries: Record<string, string> = {};
    if (parsed) {
      for (const s of steps) {
        const v = parsed[s.key];
        if (v) summaries[s.key] = sanitizeOneLine(v, "");
      }
    }
    return NextResponse.json({ ok: true, summaries });
  } catch {
    return NextResponse.json({ ok: true, summaries: {} as Record<string, string> });
  }
}
