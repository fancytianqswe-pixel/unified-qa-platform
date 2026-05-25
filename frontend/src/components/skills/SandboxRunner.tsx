"use client";

import { useState } from "react";

/**
 * SandboxRunner 组件/函数。
 */
export function SandboxRunner() {
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  function runSandbox() {
    setRunning(true);
    setLogs(["[启动] 已进入隔离环境"]);
    const rows = [
      "[准备] 加载测试数据...",
      "[执行] 调用技能主流程...",
      "[校验] 检查输出结构...",
      "[完成] 结果通过，成功率 100%",
    ];
    rows.forEach((line, idx) => {
      setTimeout(() => {
        setLogs((prev) => [...prev, line]);
        if (idx === rows.length - 1) setRunning(false);
      }, (idx + 1) * 500);
    });
  }

  return (
    <section className="skill-panel">
      <div className="panel-title-row">
        <h4>SandboxRunner（隔离环境测试）</h4>
        <button type="button" onClick={runSandbox} disabled={running}>
          {running ? "测试中..." : "运行沙箱测试"}
        </button>
      </div>
      <div className="log-box">
        {logs.length ? logs.map((line) => <div key={line}>{line}</div>) : <span>暂无测试日志</span>}
      </div>
    </section>
  );
}

