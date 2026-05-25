/**
 * Hermes Cron job → 任务中心列表行（供 BFF 与前端共用字段语义）。
 */

export type TaskCenterListRow = {
  taskId: string;
  taskName: string;
  associatedSkill: string;
  scheduleFrequency: string;
  /** true：启用；false：禁用（含 paused / enabled=false） */
  switchEnabled: boolean;
  /** ISO8601，无则 null */
  lastRunAtIso: string | null;
  /** 最近一次执行状态（供 UI 映射文案/色块） */
  lastRunStatus: "success" | "failure" | "running" | "none";
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function formatHermesScheduleDisplay(job: Record<string, unknown>): string {
  const disp = job.schedule_display;
  if (typeof disp === "string" && disp.trim()) return disp.trim();
  const sch = job.schedule;
  if (!isRecord(sch)) return "—";
  const kind = sch.kind;
  if (kind === "cron" && typeof sch.expr === "string") return sch.expr;
  if (kind === "interval" && typeof sch.minutes === "number") return `每 ${sch.minutes} 分钟`;
  if (kind === "once") {
    if (typeof sch.run_at === "string" && sch.run_at) return `单次 ${sch.run_at}`;
  }
  if (typeof sch.display === "string" && sch.display) return sch.display;
  return "—";
}

export function mapHermesJobToListRow(job: unknown): TaskCenterListRow | null {
  if (!isRecord(job)) return null;
  const id = job.id;
  if (id === undefined || id === null || String(id).trim() === "") return null;

  const skillsRaw = job.skills;
  let skillStr = "";
  if (Array.isArray(skillsRaw)) {
    skillStr = skillsRaw.map((x) => String(x).trim()).filter(Boolean).join("、");
  } else if (typeof job.skill === "string" && job.skill.trim()) {
    skillStr = job.skill.trim();
  }

  const enabled = job.enabled !== false;
  const state = typeof job.state === "string" ? job.state : "";
  const switchEnabled = enabled && state !== "paused";

  const lastRunAtIso =
    typeof job.last_run_at === "string" && job.last_run_at.trim() ? job.last_run_at.trim() : null;

  const execState = typeof job.execution_state === "string" ? job.execution_state : "";
  const lastStatus = job.last_status;

  let lastRunStatus: TaskCenterListRow["lastRunStatus"] = "none";
  if (execState === "running" || state === "running") {
    lastRunStatus = "running";
  } else if (lastStatus === "ok") {
    lastRunStatus = "success";
  } else if (lastStatus === "error") {
    lastRunStatus = "failure";
  }

  const name =
    typeof job.name === "string" && job.name.trim()
      ? job.name.trim()
      : typeof job.prompt === "string" && job.prompt.trim()
        ? job.prompt.trim().slice(0, 80)
        : String(id);

  let scheduleFrequency: string;
  try {
    scheduleFrequency = formatHermesScheduleDisplay(job);
  } catch {
    scheduleFrequency = "—";
  }

  return {
    taskId: String(id),
    taskName: name,
    associatedSkill: skillStr || "—",
    scheduleFrequency,
    switchEnabled,
    lastRunAtIso,
    lastRunStatus,
  };
}

export function mapHermesJobsToListRows(jobs: unknown[]): TaskCenterListRow[] {
  const out: TaskCenterListRow[] = [];
  for (const j of jobs) {
    const row = mapHermesJobToListRow(j);
    if (row) out.push(row);
  }
  return out;
}
