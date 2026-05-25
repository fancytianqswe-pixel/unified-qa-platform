import type { ModelConfig } from "@/store/chatStore";

/** 与 `ChatInput` 中发给 BFF 的占位一致 */
export const CHAT_MODEL_AUTO_SENTINEL = "自动";

/**
 * 输入框展示的当前模型：避免 persist 未灌入时把用户已选模型误显示为「自动」。
 */
export function resolveEffectiveChatModel(
  selected: string,
  savedModelNames: string[],
  persistHydrated: boolean,
): string {
  const m = (selected || CHAT_MODEL_AUTO_SENTINEL).trim() || CHAT_MODEL_AUTO_SENTINEL;
  if (m === CHAT_MODEL_AUTO_SENTINEL) return CHAT_MODEL_AUTO_SENTINEL;
  if (savedModelNames.includes(m)) return m;
  if (!persistHydrated) return m;
  return CHAT_MODEL_AUTO_SENTINEL;
}

export function listUsableModelConfigs(configs: ModelConfig[]): ModelConfig[] {
  return configs.filter(
    (c) => !!(c.modelName?.trim() && c.baseUrl?.trim() && c.apiKey?.trim()),
  );
}

/**
 * 解析本回合应携带的直连/上游模型配置（供 BFF 写入 `xingyan_user_llm` 或直连 `callModelDirectly`）。
 * - 「自动」：在**已填写完整**的已保存模型中**均匀随机**选一（每轮独立随机）。
 * - 指定模型名：仅在已保存且三项齐备的条目中 **严格按 modelName 匹配**；未命中则返回 undefined。
 */
export function resolveChatTurnModelConfig(
  model: string | undefined,
  modelConfigs: ModelConfig[],
): ModelConfig | undefined {
  const usable = listUsableModelConfigs(modelConfigs);
  const m = (model ?? CHAT_MODEL_AUTO_SENTINEL).trim() || CHAT_MODEL_AUTO_SENTINEL;
  if (m === CHAT_MODEL_AUTO_SENTINEL) {
    if (usable.length === 0) return undefined;
    return usable[Math.floor(Math.random() * usable.length)]!;
  }
  return usable.find((c) => c.modelName === m);
}
