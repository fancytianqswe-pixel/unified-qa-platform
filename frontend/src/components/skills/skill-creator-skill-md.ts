/**
 * 当仓库内 `bundles/skill-creator-skill/SKILL.md` 不可读时的兜底（勿删：供 load-skill-creator-md 使用）。
 */
export const SKILL_CREATOR_FALLBACK_MD = `# 技能创建助手

未能从磁盘读取已安装的 \`bundles/skill-creator-skill/SKILL.md\`。请将 \`skill-creator-skill.zip\` 解压后把 \`SKILL.md\` 放到该路径并重新部署。
`;
