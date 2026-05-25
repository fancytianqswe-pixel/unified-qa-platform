import { NewTaskChat } from "@/components/chat/NewTaskChat";
import { safeDecodeURIComponent } from "@/lib/safe-decode-uri";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ConversationPage({ params }: Props) {
  const { id: rawId } = await params;
  const id = safeDecodeURIComponent(rawId ?? "");
  return <NewTaskChat sessionId={id} />;
}

