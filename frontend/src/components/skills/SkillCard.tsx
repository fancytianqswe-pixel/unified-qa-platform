import Link from "next/link";
import { Skill } from "@/components/skills/types";
import { useI18n } from "@/i18n/I18nProvider";
import {
  displaySkillBadgeLabelForUi,
  displaySkillDescriptionForUi,
  displaySkillNameForUi,
} from "@/lib/skill-builtin-i18n";

type Props = { skill: Skill };

function SkillAvatar({ icon }: { icon: string }) {
  const t = icon.trim();
  const letterGlyph = /^[A-Za-z0-9]{1,2}$/.test(t);
  if (letterGlyph) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-semibold text-white">
        {t.toUpperCase()}
      </span>
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl leading-none dark:bg-slate-800">
      {t}
    </span>
  );
}

/**
 * 技能中心卡片：图标 + 标题 + 摘要 + 右下角来源标签（对齐市场/我的技能视觉）
 */
export function SkillCard({ skill }: Props) {
  const { t } = useI18n();
  const rawBadge =
    skill.badgeLabel ?? (skill.source === "user" ? "个人" : skill.source === "system" ? "市场" : "市场");
  const badge = displaySkillBadgeLabelForUi(rawBadge, t);

  return (
    <Link
      href={`/skills-center/${encodeURIComponent(skill.id)}`}
      className="group flex h-full flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-600 dark:bg-slate-900 dark:hover:border-slate-500"
    >
      <div className="flex gap-3">
        <SkillAvatar icon={skill.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {displaySkillNameForUi(skill, t)}
          </h3>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {displaySkillDescriptionForUi(skill, t)}
      </p>
      <div className="mt-4 flex justify-end">
        <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
          {badge}
        </span>
      </div>
    </Link>
  );
}
