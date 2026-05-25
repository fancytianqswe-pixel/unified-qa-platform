# LLM 对话过程区 UI 规范

本文约定助手消息中「过程 / 中间步骤」的展示方式，与产品参考图一致：**先给人看的摘要**，**机器向的原文与 JSON 默认收起**，且避免「步骤清单」式的编号与状态噪声。

## 适用范围

- 前端：`frontend/src/components/chat/MessageList.tsx` 内 `renderProcessDetails` → `renderProcessStepCard`、`renderToolStepTechnicalDetails`。
- 数据源：`ChatMessage.stepLogs`（Hermes 等推送的结构化步骤）及 legacy 的 `executionLogs` + `thinkingText` 回退路径。

## 规范条目

### 1. 不使用步骤编号

- 不在每条过程前展示 `1.`、`2.` 等序号。
- 复制到剪贴板的过程文本与上述一致，不对每条步骤前缀序号（与界面一致）。

### 2. 不使用整步外层的浅灰大底框

- 不再用「整卡片灰底 + 粗边框」包裹单条步骤（例如旧版 `rounded-xl border bg-gray-50` 包住标题行与折叠区）。
- 单步在视觉上以**摘要条**与**可选的展开技术区**两段组成；整体列表用纵向间距分隔（如 `space-y-2`），多条过程条紧凑堆叠。

### 3. 不展示单步「完成 / 进行中」等状态角标

- 不在摘要行右侧放「完成」等芯片；成功态由条内 **`renderAssistantProcessChrome`**（最后一条助手过程区上方）等整体状态表达即可。
- **失败**时允许在摘要条上用文案或轻量样式提示（如红色文案 + 细 ring），引导用户展开查看错误与原文。

### 4. 阶段标题与说明（`kind: phase`）

- 当上游推送 `stepLogs[].kind === "phase"` 时，与工具步一致使用**浅灰胶囊条**（`#F3F3F1` 底 + 细边框）：首行摘要为阶段标题（过长截断）；若存在换行后正文或全文较长，则整条可 **`<details>` 展开** 查看完整阶段说明，保持与工具步相同的「摘要 + chevron」交互。

### 5. 工具步骤：说明在 pill 上方

- 若原始 `message` 在首个 `{` 之前有一段自然语言（`extractProseBeforeJson`），则该段经规范化后作为**正文**展示在**灰色 pill 之上**，pill 内仍只放摘要句 + 可选数量角标 + 右侧 chevron。
- JSON 与长原文仍在展开后的技术区内。

### 6. 摘要行样式（Pill）

- 一条工具/笔记步骤的 pill 内主文案为**单行**（**`h-10` + `truncate` + `whitespace-nowrap`**）：只描述**该步在调用什么 / 试图完成什么动作**，**不写**执行成败、stderr、退出码与「下一步建议」；成败与原文在 **`<details>`** 技术区。文案优先由 **`frontend/src/lib/process-step-heuristic.ts`** 的 **`summarizeJsonBlobForPill`** / **`summarizeHermesContentPartEnvelope`** 等对 JSON 做**意图型**归纳，再经 **`compactRedundantToolNarrative`** 去重口语前缀；仍偏原文时由 **`POST /api/chat/process-steps-summarize`**（与 **`buildStepLogProcessItem`** 的 `id` 对齐）收敛为意图句。缺失时回退 `item.label` 或进行中/失败提示。
- 视觉：**圆角矩形**（`rounded-xl`）、**`#F3F3F1` 背景**、**`#E6E6E4` 细边框**；摘要条 **`inline-flex w-max`**，高度固定 **`h-10`**，宽度在 **`min-w-[10rem]` ~ `max-w-[min(100%,36rem)]`** 间随文案伸缩；左侧图标：`phase` 用 **`Sparkles`**；工具步按 **`toolName` / `label` 启发式** 选用 `Terminal` / `List` / `Settings2` / `Terminal`；可展开时右侧 **`ChevronRight`**，`group-open:rotate-90`。外层步骤容器 **`w-full`**，展开技术区可占满列宽。
- 若 JSON 中含 `total_count` 或 `items` / `files` / `entries` 等数组长度，可在摘要右侧展示 **`（N 项）`**（`tryItemCountSuffix`）。
- **禁止**在 pill 同一行挤入整段 JSON；技术内容一律在技术区。

### 7. 技术细节区样式

- 仅当存在可展示的技术块（长原文、输入/输出摘要、trace、耗时、错误码等，`hasExpandableTechnicalBlock` 为真）时使用 `<details>`：**默认收起**。
- 展开后：摘要条下方为**独立浅面板**（如 `#FAFAF8` + 细边框、圆角），内放 `pre`、键值说明等；`pre` 使用白底/细边框与浅底形成层次，便于长文滚动。
- 不再使用泛化折叠标题文案「技术明细与原始输出（默认收起）」；**折叠入口即摘要条本身**（与参考产品「一句话说明 + chevron」一致）。

### 8. 无可展开技术内容时

- 仅渲染**非交互**的摘要条（无 chevron、无 `<details>`），避免空折叠。

### 9. Legacy 叙事行（无 `stepLogs` 仅有分段 `thinkingText`）

- 纯叙事行不再使用序号与灰底卡片，与普通正文行风格接近（左对齐正文色）。

## 与条上状态的关系

- 新任务对话（`NewTaskChat`）**无**消息区外独立顶栏；运行中/已完成/耗时等由 **`MessageList`** 内 **`renderAssistantProcessChrome`**（贴最后一条助手过程区）表达；过程列表**不重复**「完成」小角标，避免双轨信息。

## 修订记录

- 初版：对齐用户提供的对话 UI 参考截图，替换旧版「编号 + 灰卡片 + 完成芯片 + 泛化折叠标题」结构。
- 第二版：对齐「阶段标题 + 正文 + 灰色 pill（右箭头、按动作类型换图标、可选（N 项））」参考图；补充 `phase` / `proseAbovePill` / `ChevronRight` / `processStepLeadingIcon` 等行为说明。
- 第三版：`phase` 与工具步统一为 **`#F3F3F1` 胶囊条**；摘要逻辑抽至 **`process-step-heuristic.ts`**；结构化 **`stepLogs` 全部展示**（不再因「低信号」隐藏）；可选 **`process-steps-summarize`** 大模型批量收敛摘要。
