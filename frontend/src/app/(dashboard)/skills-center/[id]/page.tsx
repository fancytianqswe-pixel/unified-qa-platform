import { SkillDetailView } from "@/components/skills/SkillDetailView";
import { normalizeSkillDetailRouteId } from "@/lib/skill-route-id";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function SkillDetailPage({ params }: Props) {
  const { id } = await params;
  const skillId = normalizeSkillDetailRouteId(id);
  return <SkillDetailView key={skillId} skillId={skillId} />;
}

