import { NextResponse } from "next/server";
import { ModelConfig } from "@/store/chatStore";
import { getModelRuntimeState } from "@/lib/modelRuntime";

type UpsertBody = {
  model?: ModelConfig;
};

type DeleteBody = {
  id?: string;
};

export async function GET() {
  const endpoint = process.env.HERMES_MODELS_ENDPOINT?.trim();
  if (!endpoint) {
    return NextResponse.json({ ok: true, list: getModelRuntimeState().models });
  }

  try {
    const response = await fetch(endpoint, { method: "GET" });
    if (!response.ok) {
      return NextResponse.json({ ok: true, list: getModelRuntimeState().models });
    }
    const data = await response.json();
    return NextResponse.json({ ok: true, list: Array.isArray(data.list) ? data.list : [] });
  } catch {
    return NextResponse.json({ ok: true, list: getModelRuntimeState().models });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as UpsertBody;
  if (!body.model?.id) {
    return NextResponse.json({ ok: false, message: "model.id 为必填" }, { status: 400 });
  }

  const endpoint = process.env.HERMES_MODELS_ENDPOINT?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }
    } catch {
      // ignore and fallback
    }
  }

  const state = getModelRuntimeState();
  const idx = state.models.findIndex((item) => item.id === body.model!.id);
  if (idx >= 0) {
    state.models[idx] = body.model!;
  } else {
    state.models.unshift(body.model!);
  }
  return NextResponse.json({ ok: true, list: state.models });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as DeleteBody;
  if (!body.id) {
    return NextResponse.json({ ok: false, message: "id 为必填" }, { status: 400 });
  }

  const endpoint = process.env.HERMES_MODELS_ENDPOINT?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }
    } catch {
      // ignore and fallback
    }
  }

  const state = getModelRuntimeState();
  state.models = state.models.filter((item) => item.id !== body.id);
  return NextResponse.json({ ok: true, list: state.models });
}
