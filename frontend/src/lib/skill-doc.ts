import type { Skill } from "@/components/skills/types";

/** 无后端文档时，由技能元数据生成 SKILL.md 正文 */
export function buildDefaultSkillMarkdown(skill: Skill): string {
  const params =
    skill.params?.length ?
      skill.params
        .map((p) => `- \`${p.key}\`（${p.required ? "必填" : "选填"}）: ${p.desc}`)
        .join("\n")
    : "- 无";

  return `# ${skill.name}

${skill.description}

## 使用示例

\`\`\`text
${skill.samplePrompt}
\`\`\`

## 参数说明

${params}

## 运行配置（摘要）

| 项 | 值 |
| --- | --- |
| 服务地址 | \`${skill.config.url}\` |
| 质量阈值 | ${skill.config.threshold} |
| 版本 | ${skill.version ?? "-"} |
`;
}

export function getSkillMarkdown(skill: Skill): string {
  return (skill.skillDocMarkdown && skill.skillDocMarkdown.trim()) || buildDefaultSkillMarkdown(skill);
}
