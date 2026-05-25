import type { DataSourceRecord } from "@/components/data/types";

export type CardType =
  | "data_preview"
  | "execution_plan"
  | "error_diagnosis"
  | "skill_confirm"
  | "datasource_saved"
  | "datasource_draft";

export type DataPreviewPayload = {
  samples: Array<Record<string, string | number>>;
  mappings: Array<{ source: string; target: string }>;
  media: string[];
};

export type ExecutionPlanPayload = {
  steps: string[];
};

export type ErrorDiagnosisPayload = {
  reason: string;
  suggestions: string[];
};

export type SkillConfirmPayload = {
  name: string;
  description: string;
  scene: string;
};

export type DatasourceSavedPayload = {
  recordId: string;
  name: string;
  summary: string;
};

/** 草稿卡片 UI 进度（随会话消息持久化，避免切换会话后重置） */
export type DatasourceDraftUiState = {
  /** 连接八项指纹；变更后丢弃旧 draft */
  configFingerprint: string;
  /** 用户补填的真实密码（配置块为 *** 时） */
  passwordOverride?: string;
  testResult?: {
    ok: boolean;
    message?: string;
    latencyMs?: number;
  };
  availableFields?: string[];
  pickedFields?: string[];
  previewRows?: Array<Record<string, unknown>>;
  savedFinal?: boolean;
};

export type DatasourceDraftPayload = {
  record: DataSourceRecord;
  draft?: DatasourceDraftUiState;
};

export type MessageCard =
  | { type: "data_preview"; payload: DataPreviewPayload }
  | { type: "execution_plan"; payload: ExecutionPlanPayload }
  | { type: "error_diagnosis"; payload: ErrorDiagnosisPayload }
  | { type: "skill_confirm"; payload: SkillConfirmPayload }
  | { type: "datasource_saved"; payload: DatasourceSavedPayload }
  | { type: "datasource_draft"; payload: DatasourceDraftPayload };

export type AssistantStepLog = {
  kind?: "phase" | "tool" | "note";
  step: string;
  status: "success" | "error" | "running";
  message: string;
  phaseId?: "understand" | "plan" | "execute" | "reflect" | "other";
  toolName?: string;
  latencyMs?: number;
  errorCode?: string;
  inputPreview?: string;
  outputPreview?: string;
  traceId?: string;
};

/** Hermes 流式过程时间线：叙述（正文 delta）与步骤（reasoning / tool）按发生顺序交错 */
export type ProcessTimelineEntry =
  | { kind: "narrative"; text: string }
  | { kind: "step"; log: AssistantStepLog };

export type ContentBlock =
  | { type: "text"; text: string }
  /** skillId：Hermes 目录技能 id（如 `h1:skill-creator-skill`），供 BFF 拉取 SKILL.md */
  | { type: "skill_card"; name: string; skillId?: string }
  /** 真上传后带 attachmentId + storedFileName，供 BFF 校验磁盘并注入 Hermes 可读绝对路径 */
  | { type: "file_card"; name: string; attachmentId?: string; storedFileName?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  cards?: MessageCard[];
  blocks?: ContentBlock[];
  stepLogs?: AssistantStepLog[];
  /** 与 Hermes 事件顺序一致：叙述 + 工具/阶段交错；**末次工具调用之后**的 `narrative` 从过程区展平中剔除（`omitNarrativesAfterLastToolStep`），正文区走全文 + 前缀剥离/锚点，不再单独截取该尾段。 */
  processTimeline?: ProcessTimelineEntry[];
  /**
   * 回合结束后由前端固化的「面向用户正文区」：`text` 仍为 Hermes 全文存档。
   * - 有 `processTimeline` 叙述块时：对 `text` 做 `stripDisclosedProcessNarrativePrefix` 后再按锚点收窄 / 全文兜底（与流式条内推断一致）。
   * - 无叙述时间线时：保持 `undefined`，界面用全文 + 前缀剥离 + 锚点推断。
   */
  assistantViewMarkdown?: string;
  process?: {
    turnId?: string;
    phase?: "sending" | "waiting_first_chunk" | "streaming" | "completed" | "failed" | "cancelled";
    status: "running" | "completed" | "failed";
    startedAt: string;
    endedAt?: string;
    thinkingText: string;
    executionLogs: string[];
  };
};

export type UnifiedChatEventType =
  | "meta"
  | "text.delta"
  | "reasoning.delta"
  | "tool.started"
  | "tool.completed"
  | "step"
  | "turn.heartbeat"
  | "turn.completed"
  | "turn.failed";

export type UnifiedChatEventEnvelope = {
  seq?: number;
  traceId?: string;
  source?: "hermes" | "model-direct" | "bff";
  retryableError?: boolean;
};

