"use client";

import { useState } from "react";
import { MonitoringChart } from "@/components/skills/MonitoringChart";

/**
 * PublishManager 组件/函数。
 */
export function PublishManager() {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const versions = [
    { version: "v1.2.0", note: "优化容错重试与字段映射", date: "2026-04-26" },
    { version: "v1.1.0", note: "新增 SQL 阈值配置", date: "2026-04-20" },
    { version: "v1.0.0", note: "初版上线", date: "2026-04-10" },
  ];

  function submitReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <section className="skill-panel">
      <h4>发布管理</h4>

      <form className="review-form" onSubmit={submitReview}>
        <h5>提交审核</h5>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="版本标题" required />
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
          placeholder="变更说明"
          required
        />
        <button type="submit">提交审核</button>
        {submitted ? <p className="ok-tip">已提交审核，等待管理员处理。</p> : null}
      </form>

      <div className="version-list">
        <h5>版本迭代历史</h5>
        {versions.map((v) => (
          <div key={v.version} className="version-item">
            <strong>{v.version}</strong>
            <span>{v.note}</span>
            <span>{v.date}</span>
          </div>
        ))}
      </div>

      <div>
        <h5>效果监控看板（ECharts）</h5>
        <MonitoringChart />
      </div>
    </section>
  );
}

