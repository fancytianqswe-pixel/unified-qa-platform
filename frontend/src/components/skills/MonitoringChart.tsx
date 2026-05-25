"use client";

import ReactECharts from "echarts-for-react";

/**
 * MonitoringChart 组件/函数。
 */
export function MonitoringChart() {
  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["调用次数", "成功率"] },
    xAxis: {
      type: "category",
      data: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    },
    yAxis: [{ type: "value" }, { type: "value", max: 100 }],
    series: [
      { name: "调用次数", type: "line", smooth: true, data: [120, 132, 121, 156, 190, 201, 176] },
      { name: "成功率", type: "line", smooth: true, yAxisIndex: 1, data: [92, 93, 94, 95, 94, 96, 97] },
    ],
  };

  return <ReactECharts option={option} style={{ height: 280 }} />;
}

