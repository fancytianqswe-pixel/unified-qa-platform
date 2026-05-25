"use client";

import { MessageCard } from "@/components/chat/types";
import { DataPreviewCard } from "@/components/chat/cards/DataPreviewCard";
import { ExecutionPlanCard } from "@/components/chat/cards/ExecutionPlanCard";
import { ErrorDiagnosisCard } from "@/components/chat/cards/ErrorDiagnosisCard";
import { SkillConfirmCard } from "@/components/chat/cards/SkillConfirmCard";
import { DatasourceSavedCard } from "@/components/chat/cards/DatasourceSavedCard";
import { DatasourceDraftCard } from "@/components/chat/cards/DatasourceDraftCard";

type Props = {
  cards: MessageCard[];
};

/**
 * AdaptiveCardRenderer 组件/函数。
 */
export function AdaptiveCardRenderer({ cards }: Props) {
  if (!cards?.length) return null;

  return (
    <div className="mt-3 space-y-3">
      {cards.map((card, idx) => {
        const key = `${card.type}-${idx}`;
        switch (card.type) {
          case "data_preview":
            return <DataPreviewCard key={key} payload={card.payload} />;
          case "execution_plan":
            return <ExecutionPlanCard key={key} payload={card.payload} />;
          case "error_diagnosis":
            return <ErrorDiagnosisCard key={key} payload={card.payload} />;
          case "skill_confirm":
            return <SkillConfirmCard key={key} payload={card.payload} />;
          case "datasource_saved":
            return <DatasourceSavedCard key={key} payload={card.payload} />;
          case "datasource_draft":
            return (
              <DatasourceDraftCard
                key={`datasource-draft-${card.payload.record.id}`}
                payload={card.payload}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

