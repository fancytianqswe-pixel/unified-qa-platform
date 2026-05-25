/**
 * 将 Hermes / OpenAI 风格工具名转为面向用户的中文说明（过程区、叙事句、日志行）。
 */

const KNOWN_TOOL_LABELS: Record<string, string> = {
  // skills_tools
  skills_list: "浏览技能列表",
  skill_view: "加载技能说明（SKILL.md）",
  skill_manage: "创建或更新技能文件",
  // file_tools（与 Hermes 命名对齐的常见项）
  read_file: "读取项目文件",
  write_file: "写入项目文件",
  search_files: "按文件名查找",
  patch: "应用代码补丁",
  // web / terminal / browser（按需扩展）
  web_search: "联网搜索",
  web_extract: "提取网页内容",
  terminal: "执行终端命令",
  browser_navigate: "浏览器打开页面",
  browser_snapshot: "截取页面结构",
  browser_click: "浏览器点击",
  browser_type: "浏览器输入",
  browser_scroll: "浏览器滚动",
  browser_back: "浏览器后退",
  browser_press: "浏览器按键",
  browser_get_images: "获取页面图片",
  browser_vision: "页面视觉分析",
  browser_console: "读取控制台日志",
  vision_analyze: "分析图片内容",
  image_generate: "生成图片",
  text_to_speech: "文字转语音",
  mixture_of_agents: "多模型协同",
  cronjob: "定时任务",
  execute_code: "执行代码",
  codebase_search: "语义搜索代码库",
  grep: "文本搜索",
  glob_file_search: "按通配符查找文件",
  list_dir: "列出目录",
  run_terminal_cmd: "运行终端命令",
  todo_write: "更新任务清单",
  apply_patch: "应用补丁",
};

function isCallIdToken(s: string): boolean {
  return /^call_[a-z0-9]+$/i.test(s.trim());
}

/**
 * 工具名 / 步骤 id → 中文胶囊标题
 */
export function humanizeHermesToolName(raw: string): string {
  const s = raw.trim();
  if (!s) return "助手步骤";
  if (isCallIdToken(s)) return "工具调用";
  const key = s.toLowerCase();
  if (KNOWN_TOOL_LABELS[key]) return KNOWN_TOOL_LABELS[key];
  if (/^[a-z][a-z0-9_]*$/i.test(s) && s.includes("_")) {
    return "执行助手能力";
  }
  return s;
}

/**
 * 把服务端模板句里的英文工具名换成中文（不改变语义结构）。
 */
export function humanizeHermesProcessMessage(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/(工具|调用工具|开始调用工具|正在执行工具|执行工具)「([^」]+)」/g, (_, prefix: string, id: string) => {
    return `${prefix}「${humanizeHermesToolName(id)}」`;
  });
  out = out.replace(/我调用了「([^」]+)」/g, (_, id: string) => `我调用了「${humanizeHermesToolName(id)}」`);
  out = out.replace(/工具「([^」]+)」已完成/g, (_, id: string) => `工具「${humanizeHermesToolName(id)}」已完成`);
  return out;
}
