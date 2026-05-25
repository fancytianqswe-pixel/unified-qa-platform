import { ModelConfig } from "@/store/chatStore";

type RuntimeState = {
  models: ModelConfig[];
};

declare global {
  var __modelRuntimeState: RuntimeState | undefined;
}

export function getModelRuntimeState(): RuntimeState {
  if (!globalThis.__modelRuntimeState) {
    globalThis.__modelRuntimeState = { models: [] };
  }
  return globalThis.__modelRuntimeState;
}
