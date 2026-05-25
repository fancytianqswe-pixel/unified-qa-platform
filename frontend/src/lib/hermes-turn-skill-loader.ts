import { fetchHermesRemoteSkillDetail, fetchHermesRemoteSkillList } from "@/lib/hermes-skills-client";

const MAX_COMBINED_CHARS = 32000;

const SKILL_HEADER =
  "以下为从 Hermes Gateway 技能目录实时拉取的 SKILL.md 正文（若过长会截断）。本轮须将该内容视为当前生效技能说明：\n\n";

/** 注入到 skill-creator 技能正文之后，纠正网关在容器内「只在 ~/ 搜 *.md」导致 total_count=0 的误判 */
const SKILL_CREATOR_HERMES_APPENDIX = `

---

## Hermes / 容器运行补充（由统一质检平台 BFF 注入，须遵守）

当你要**读取、评测或审计其他技能**（Route C/D 等）并调用「按文件名查找 / glob」类工具时：

1. 用户通过 Hermes 安装的技能通常在 **\`~/.hermes/skills/<技能目录名>/SKILL.md\`**；与本仓库同步的平台技能可能在 **\`/opt/platform-skills/<目录>/SKILL.md\`**（若网关容器已挂载 platform-skills）。
2. **禁止**把 **\`~/\`** 根目录当作技能根路径做 **\`**/*.md\`** 盲搜并据此判断「技能不存在」——容器内 **\`~/\`** 下可能没有 Markdown，工具会返回 **total_count: 0**，这与「其他技能未安装」不是一回事。
3. 正确顺序：先列出 **\`~/.hermes/skills/\`** 子目录，再进入目标目录读 **\`SKILL.md\`**；或请用户提供 Hermes 技能 id（如 **\`h0:dogfood\`**）或粘贴 **\`SKILL.md\`** 全文。
4. 若工具未命中文件，应如实说明「当前搜索路径下无匹配文件」，并追问路径或请用户粘贴内容；**不要**用「技能加载失败」等笼统话术掩盖**搜索路径不当**；也不得谎称已「掌握完整评价流程」来绕过证据要求（须遵守 SKILL 中 Truthfulness 规则）。
`;

/**
 * 输入区卡片展示名（技能中心 / 底部快捷）→ 平台包目录名，用于匹配 Hermes 列表 id（`h{n}:<relpath>`）。
 * 与 `platform-skills` 下文件夹名一致。
 */
const DISPLAY_CARD_NAME_TO_SKILL_DIR: Record<string, string> = {
  技能创建助手: "skill-creator-skill",
  /** 与目录 / 内置 id 一致时的 YAML `name`（优先于旧短名 `skill-creator`） */
  "skill-creator-skill": "skill-creator-skill",
  /** 旧包 YAML 短名 → 仍解析到目录 `skill-creator-skill` */
  "skill-creator": "skill-creator-skill",
  数据源配置助手: "datasource-wizard-skill",
  数据规则审核助手: "data-rule-audit-skill",
};

export type HermesTurnSkillLoadResult = {
  combinedMarkdown: string | null;
  /** 已从 Hermes 加载数据源向导技能正文时，可与 BFF 常量向导去重，仅保留磁盘 SKILL.md */
  usedDatasourceWizardSkillFromHermes: boolean;
  /** 本轮含从 Hermes 拉取的 skill-creator-skill 正文（用于观测/扩展，正文后已附路径补充） */
  usedSkillCreatorSkillFromHermes: boolean;
  /** 已从 Hermes 加载 data-rule-audit-skill 正文 */
  usedDataRuleAuditSkillFromHermes: boolean;
};

type SkillCardBlock = { type?: string; name?: string; skillId?: string };

function skillRelPathFromHermesId(id: string): string {
  const idx = id.indexOf(":");
  if (idx === -1) return id.trim();
  return id.slice(idx + 1).trim();
}

function isDatasourceWizardHermesId(id: string): boolean {
  const rel = skillRelPathFromHermesId(id);
  return rel === "datasource-wizard-skill" || rel.endsWith("/datasource-wizard-skill");
}

function isDataRuleAuditHermesId(id: string): boolean {
  const rel = skillRelPathFromHermesId(id);
  return rel === "data-rule-audit-skill" || rel.endsWith("/data-rule-audit-skill");
}

function isSkillCreatorHermesId(id: string): boolean {
  const rel = skillRelPathFromHermesId(id);
  return (
    rel === "skill-creator-skill" ||
    rel.endsWith("/skill-creator-skill") ||
    rel === "skill-creator" ||
    rel.endsWith("/skill-creator")
  );
}

export async function loadHermesSkillMarkdownForTurn(
  blocks: SkillCardBlock[] | undefined,
): Promise<HermesTurnSkillLoadResult> {
  if (!Array.isArray(blocks) || !blocks.length) {
    return {
      combinedMarkdown: null,
      usedDatasourceWizardSkillFromHermes: false,
      usedSkillCreatorSkillFromHermes: false,
      usedDataRuleAuditSkillFromHermes: false,
    };
  }
  const cards = blocks.filter((b) => b && b.type === "skill_card") as SkillCardBlock[];
  if (!cards.length) {
    return {
      combinedMarkdown: null,
      usedDatasourceWizardSkillFromHermes: false,
      usedSkillCreatorSkillFromHermes: false,
      usedDataRuleAuditSkillFromHermes: false,
    };
  }

  const listResp = await fetchHermesRemoteSkillList();
  const list = Array.isArray(listResp?.list)
    ? (listResp!.list as Array<{ id?: string; name?: string }>)
    : [];

  const resolveId = (block: SkillCardBlock): string | null => {
    const sid = (block.skillId || "").trim();
    if (sid.startsWith("h") && sid.includes(":")) return sid;
    const name = (block.name || "").trim();
    if (!name) return null;
    const dirHint = DISPLAY_CARD_NAME_TO_SKILL_DIR[name];
    if (dirHint) {
      const hit = list.find((s) => {
        const id = String(s.id || "");
        const rel = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
        return rel === dirHint || rel.endsWith(`/${dirHint}`);
      });
      if (hit?.id) return String(hit.id);
    }
    const byYamlName = list.find((s) => String(s.name || "").trim() === name);
    if (byYamlName?.id) return String(byYamlName.id);
    return null;
  };

  const parts: string[] = [];
  let usedDatasourceWizardSkillFromHermes = false;
  let usedSkillCreatorSkillFromHermes = false;
  let usedDataRuleAuditSkillFromHermes = false;

  for (const card of cards) {
    const id = resolveId(card);
    if (!id) continue;
    const detail = await fetchHermesRemoteSkillDetail(id);
    const skill = detail?.skill as { skillDocMarkdown?: string } | undefined;
    const md = typeof skill?.skillDocMarkdown === "string" ? skill.skillDocMarkdown.trim() : "";
    if (!md) continue;

    if (isDatasourceWizardHermesId(id)) {
      usedDatasourceWizardSkillFromHermes = true;
    }
    if (isSkillCreatorHermesId(id)) {
      usedSkillCreatorSkillFromHermes = true;
    }
    if (isDataRuleAuditHermesId(id)) {
      usedDataRuleAuditSkillFromHermes = true;
    }

    parts.push(md);
  }

  if (!parts.length) {
    return {
      combinedMarkdown: null,
      usedDatasourceWizardSkillFromHermes: false,
      usedSkillCreatorSkillFromHermes: false,
      usedDataRuleAuditSkillFromHermes: false,
    };
  }

  let combined = parts.join("\n\n---\n\n");
  if (combined.length > MAX_COMBINED_CHARS) {
    combined = `${combined.slice(0, MAX_COMBINED_CHARS - 24).trimEnd()}\n\n…（已截断）`;
  }
  if (usedSkillCreatorSkillFromHermes) {
    combined += SKILL_CREATOR_HERMES_APPENDIX;
  }

  return {
    combinedMarkdown: SKILL_HEADER + combined,
    usedDatasourceWizardSkillFromHermes,
    usedSkillCreatorSkillFromHermes,
    usedDataRuleAuditSkillFromHermes,
  };
}
