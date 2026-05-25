import { NextResponse } from "next/server";
import { fetchHermesJobsList } from "@/lib/hermes-jobs-client";
import { mapHermesJobsToListRows } from "@/lib/task-center-map";

/** 显式 Node：避免在极端部署下被当作 Edge 运行时，缺少稳定 `fetch`/DNS 行为。 */
export const runtime = "nodejs";

/**
 * 任务中心列表：代理 Hermes `GET /api/jobs`（含 `include_disabled=true`）。
 */
export async function GET() {
  try {
    const remote = await fetchHermesJobsList();
    if (!remote.ok) {
      return NextResponse.json({
        ok: false,
        tasks: [] as ReturnType<typeof mapHermesJobsToListRows>,
        message: String(remote.message ?? ""),
      });
    }
    let tasks: ReturnType<typeof mapHermesJobsToListRows>;
    try {
      tasks = mapHermesJobsToListRows(remote.jobs);
    } catch (e) {
      console.error("[api/tasks/list] mapHermesJobsToListRows", e);
      return NextResponse.json({
        ok: false,
        tasks: [],
        message: "任务数据解析失败，请检查 Hermes 返回的 jobs 结构",
      });
    }
    return NextResponse.json({
      ok: true,
      tasks,
      source: remote.sourceUrl,
    });
  } catch (e) {
    console.error("[api/tasks/list]", e);
    const message = String(e instanceof Error ? e.message : "服务器内部错误");
    return NextResponse.json({ ok: false, tasks: [], message }, { status: 500 });
  }
}
