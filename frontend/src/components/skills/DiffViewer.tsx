"use client";

import { SkillConfig } from "@/components/skills/types";

type Props = {
  original: SkillConfig;
  current: SkillConfig;
  onRollback: () => void;
};

function diffClass(before: string | number, after: string | number) {
  return before === after ? "diff-line" : "diff-line changed";
}

/**
 * DiffViewer 组件/函数。
 */
export function DiffViewer({ original, current, onRollback }: Props) {
  return (
    <section className="skill-panel">
      <div className="panel-title-row">
        <h4>DiffViewer（原模板 vs 修改版）</h4>
        <button type="button" className="btn-secondary" onClick={onRollback}>
          回滚到原模板
        </button>
      </div>
      <div className="diff-grid">
        <div>
          <h5>原模板</h5>
          <div className={diffClass(original.url, current.url)}>url: {original.url}</div>
          <div className={diffClass(original.sql, current.sql)}>sql: {original.sql}</div>
          <div className={diffClass(original.threshold, current.threshold)}>
            threshold: {original.threshold}
          </div>
        </div>
        <div>
          <h5>修改版</h5>
          <div className={diffClass(original.url, current.url)}>url: {current.url}</div>
          <div className={diffClass(original.sql, current.sql)}>sql: {current.sql}</div>
          <div className={diffClass(original.threshold, current.threshold)}>
            threshold: {current.threshold}
          </div>
        </div>
      </div>
    </section>
  );
}

