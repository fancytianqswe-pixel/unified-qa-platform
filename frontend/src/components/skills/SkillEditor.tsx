"use client";

import { useMemo, useState } from "react";
import { SkillConfig } from "@/components/skills/types";
import { DiffViewer } from "@/components/skills/DiffViewer";
import { SandboxRunner } from "@/components/skills/SandboxRunner";
import { PublishManager } from "@/components/skills/PublishManager";

type Props = {
  originalConfig: SkillConfig;
};

/**
 * SkillEditor 组件/函数。
 */
export function SkillEditor({ originalConfig }: Props) {
  const [config, setConfig] = useState<SkillConfig>({ ...originalConfig });
  const [tweakInput, setTweakInput] = useState("");

  const hasDiff = useMemo(
    () =>
      config.url !== originalConfig.url ||
      config.sql !== originalConfig.sql ||
      config.threshold !== originalConfig.threshold,
    [config, originalConfig],
  );

  function applyAiTweak() {
    const text = tweakInput.trim();
    if (!text) return;

    // Demo逻辑：模拟 AI 修改底层 JSON config。
    const next = { ...config };
    if (text.includes("阈值")) next.threshold = Number((config.threshold + 0.03).toFixed(2));
    if (text.includes("URL") || text.includes("地址")) next.url = `${config.url}?from=ai-tuned`;
    if (text.includes("SQL")) next.sql = `${config.sql} /* ai-tuned */`;

    setConfig(next);
  }

  return (
    <div className="editor-wrap">
      <section className="skill-panel editor-grid">
        <div>
          <h4>SkillEditor - 可视化配置</h4>
          <label>
            URL
            <input
              value={config.url}
              onChange={(e) => setConfig((s) => ({ ...s, url: e.target.value }))}
            />
          </label>
          <label>
            SQL
            <textarea
              rows={4}
              value={config.sql}
              onChange={(e) => setConfig((s) => ({ ...s, sql: e.target.value }))}
            />
          </label>
          <label>
            阈值
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={config.threshold}
              onChange={(e) => setConfig((s) => ({ ...s, threshold: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div>
          <h4>对话式微调</h4>
          <textarea
            rows={5}
            value={tweakInput}
            onChange={(e) => setTweakInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              if (e.nativeEvent.isComposing) return;
              if (!tweakInput.trim()) return;
              e.preventDefault();
              applyAiTweak();
            }}
            placeholder="例如：把阈值调高一点，并在 SQL 增加过滤条件"
          />
          <button type="button" onClick={applyAiTweak}>
            AI 修改 JSON Config
          </button>
          {hasDiff ? <p className="ok-tip">检测到配置差异，Diff 区域已高亮。</p> : null}
        </div>
      </section>

      <DiffViewer original={originalConfig} current={config} onRollback={() => setConfig({ ...originalConfig })} />
      <SandboxRunner />
      <PublishManager />
    </div>
  );
}

