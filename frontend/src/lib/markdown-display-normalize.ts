/**
 * 将模型常输出的「非严格 CommonMark」写法规整为 remark 可稳定解析的形态。
 * 典型问题：
 * - `##标题`、`###Q1`（ATX 与 `#` 间缺空格）、`>提示`（引用缺空格）
 * - **标题/分隔线/表与上一句粘在同一行**（`。## …`、`---## …`、`##📋…`（emoji 标题）、`|a|b||---|`），remark 会整段落成单个 `<p>`，界面看起来像「未按 MD 渲染」
 * - 字面量 `\\n`、Unicode 行分隔符、**全角 `＊`（U+FF0A）** 等
 * - **GFM 表**：`|a|b||---|` 或 **`|a|b|---|---|`** 单行粘连时拆行
 */
export function normalizeMarkdownForRemark(src: string): string {
  if (!src) return src;
  let s = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\u2028|\u2029/g, "\n");
  s = s.replace(/\uFEFF/g, "");
  s = s.replace(/[\u200B-\u200D]/g, "");

  /** 全角星号 → ASCII，否则 `＊＊粗体＊＊` 无法被 remark 识别为 emphasis */
  s = s.replace(/\uFF0A/g, "*");

  /** 部分链路把换行写成字面量 `\n`（两字符），导致标题永远不在行首 */
  if (/\\n/.test(s) && /#{2,6}|>\s|^\s*\|.*\|/m.test(s)) {
    s = s.replace(/\\n/g, "\n");
  }

  /** `---## 标题`：水平线与 ATX 标题粘在同一逻辑行 */
  s = s.replace(/(^|\n)(-{3,})\s*(#{2,6})/gm, "$1$2\n\n$3");

  /** `…文字---##`：`---` 非行首但与 `##` 粘连（模型常见装饰 + 标题） */
  s = s.replace(/(?<=[^-\n])(-{3,})\s*(#{2,6})/g, "\n\n$1\n\n$2");

  /** `## 前一节…---### 下一节`（含 `##📋…---###`：`#` 与标题字间可无空格） */
  s = s.replace(/(#{2,6})(\s*)([^\n]+?)(-{3,})\s*(#{2,6})/g, "$1$2$3\n\n$4\n\n$5");

  /**
   * 流式 delta 拼接成「一整行」时：`…文字## 标题` / `…）## 标题` / `…##📋 报告`，须让 `##` 位于行首。
   *  lookahead：`##` 后为空白，或**任意非 ASCII**（覆盖 emoji、CJK、全角标点），避免误伤 URL 的 `path##ascii`。
   */
  s = s.replace(/(?<=\S)(#{2,6})(?=\s|[^\u0000-\u007F])/gu, "\n\n$1");

  /** 连续 3+ 空行压成双换行，避免块级解析异常 */
  s = s.replace(/\n{3,}/g, "\n\n");

  /**
   * 句读/括号后紧跟 ATX 标题：插入空行使 `##` 位于行首（CommonMark 要求）。
   */
  const punctBeforeHeading = /([，、。！？；：]|[,.!?:;)])(\s*)(#{2,6}\s)/g;
  s = s.replace(punctBeforeHeading, "$1$2\n\n$3");

  /** 句读后紧跟块引用 */
  s = s.replace(/([，、。！？；：]|[,.!?:;)])(\s*)(>\s)/g, "$1$2\n\n$3");

  /** 句读后紧跟 `---` 水平线（须单独成行） */
  s = s.replace(/([，、。！？；：]|[,.!?:;)])(\s*)(-{3,}\s*\n)/g, "$1$2\n\n$3");

  /**
   * GFM 表头与分隔行被写成 `|c1|c2||---|---|`（双 `|`），拆成合法两行。
   * `((?:[^|\r\n]+\|)+)` 为「单元格|」重复，不含最外层左右竖线。
   */
  s = s.replace(/\|((?:[^|\r\n]+\|)+)\|\|\s*((?:-{3,}\|)+)/g, "|$1|\n|$2");

  /**
   * `|a|b|c|---|---|` 单行粘连（无 `||` 时上一规则不拆）：在「多列表头」与「仅含 `-` 的分隔行」之间插入换行。
   * 要求表头至少两列、分隔行至少两列，降低误伤正文里 `|a|path-1-2-3|` 的概率。
   */
  s = s.replace(/(\|(?:[^|\r\n]+\|){2,})(\|(?:-{3,}\|){2,})/g, "$1\n$2");

  // 行首 ATX 标题：`##xxx` -> `## xxx`（不破坏已带空格的写法）
  s = s.replace(/(^|\n)(#{1,6})(?=[^\s#\n])/gm, "$1$2 ");
  // 行首块引用：`>xxx` -> `> xxx`
  s = s.replace(/(^|\n)>(?=[^\s>\n-])/gm, "$1> ");
  return s;
}

/**
 * 助手正文区 ReactMarkdown 外层样式（未使用 @tailwindcss/typography 时的轻量「类 prose」）。
 */
export const ASSISTANT_MARKDOWN_BODY_CLASS =
  [
    /** 与外层气泡 `text-sm` 对齐：正文 14px、标题略大但不「海报字号」；strong 用 medium 避免整段黑粗 */
    "assistant-markdown max-w-full text-[14px] leading-6 text-gray-800 dark:text-slate-200",
    "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-gray-900 [&_h1]:dark:text-slate-50",
    "[&_h2]:mt-2.5 [&_h2]:mb-1.5 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-1 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:dark:border-slate-700 [&_h2]:dark:text-slate-50",
    "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-gray-900 [&_h3]:dark:text-slate-100",
    "[&_h4]:mt-2 [&_h4]:mb-0.5 [&_h4]:text-[14px] [&_h4]:font-medium [&_h4]:text-gray-900 [&_h4]:dark:text-slate-100",
    "[&_p]:my-1.5 [&_p]:text-[14px] [&_p]:leading-6 [&_p]:font-normal",
    "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[14px]",
    "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-[14px]",
    "[&_li]:my-0.5",
    "[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-amber-200/90 [&_blockquote]:bg-amber-50/60 [&_blockquote]:pl-3 [&_blockquote]:py-1.5 [&_blockquote]:text-gray-800 [&_blockquote]:dark:border-amber-700/80 [&_blockquote]:dark:bg-amber-950/35 [&_blockquote]:dark:text-slate-200",
    "[&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-gray-200 [&_hr]:dark:border-slate-700",
    "[&_strong]:font-medium [&_strong]:text-gray-900 [&_strong]:dark:text-slate-100",
    "[&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-gray-800 [&_code]:dark:bg-slate-800 [&_code]:dark:text-slate-200",
    "[&_pre]:my-2 [&_pre]:max-h-[min(70vh,32rem)] [&_pre]:overflow-x-auto [&_pre]:overflow-y-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-gray-200 [&_pre]:bg-gray-50 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:dark:border-slate-600 [&_pre]:dark:bg-slate-900/90 [&_pre]:dark:text-slate-200",
    "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_a]:text-blue-700 [&_a]:underline [&_a]:dark:text-blue-400",
    "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]",
    "[&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-medium [&_th]:dark:border-slate-600 [&_th]:dark:bg-slate-800 [&_th]:dark:text-slate-100",
    "[&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_td]:text-[13px] [&_td]:dark:border-slate-600 [&_td]:dark:text-slate-200",
  ].join(" ");
