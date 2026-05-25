export type Skill = {
  id: string;
  icon: string;
  name: string;
  author: string;
  version?: string;
  source?: "system" | "user";
  status?: "published" | "draft" | "reviewing";
  rating: number;
  usageCount: number;
  description: string;
  samplePrompt: string;
  params: Array<{ key: string; desc: string; required: boolean }>;
  config: {
    url: string;
    sql: string;
    threshold: number;
  };
  /** 市场精选 Tab 下的分类筛选（如「通用工具」） */
  category?: string;
  /** 分类上方的区块标题，默认「办公提效」 */
  catalogSection?: string;
  /** 卡片右下角标签文案，如「市场」「个人」「飞猪官方」 */
  badgeLabel?: string;
  /** 市场精选 / 我的技能 */
  listScope?: "market" | "mine";
  /**
   * 「我的技能」内来源：平台预置 vs 用户自建/上传。
   * 未传时由前端根据 `listScope`+`source` 推断：`source===user` → 个人，否则 → 平台内置。
   */
  mineKind?: "platform" | "personal";
  /** 预留：数据可标记废弃，界面不再展示文案 */
  deprecated?: boolean;
  /** 详情页「更新时间」展示，建议 YYYY-MM-DD */
  updatedAt?: string;
  /** 详情页 SKILL.md 原文；缺省时由 buildDefaultSkillMarkdown 生成 */
  skillDocMarkdown?: string;
  /** `builtin`：产品内置技能，详情页不展示订阅/克隆等 */
  skillPolicy?: "default" | "builtin";
};

export type SkillConfig = Skill["config"];

