import { NextResponse } from "next/server";
import { saveChatUploadToDisk } from "@/lib/chat-upload-storage";

export const runtime = "nodejs";

/**
 * 对话附件真上传：multipart 字段名 `file`，写入 CHAT_UPLOAD_DIR（默认 ~/.hermes/chat-uploads），
 * 与 Hermes 网关 ~/.hermes:/opt/data 挂载对齐，返回网关内绝对路径供本轮 Hermes 推理读盘。
 */
export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, message: "请使用 multipart/form-data，字段名为 file" },
        { status: 400 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "缺少 file 字段" }, { status: 400 });
    }
    const res = await saveChatUploadToDisk(file);
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: res.message }, { status: res.status });
    }
    const d = res.data;
    return NextResponse.json({
      ok: true,
      attachmentId: d.attachmentId,
      name: d.displayName,
      storedFileName: d.storedFileName,
      sizeBytes: d.sizeBytes,
      hermesPath: d.hermesPath,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "上传失败" },
      { status: 500 },
    );
  }
}
