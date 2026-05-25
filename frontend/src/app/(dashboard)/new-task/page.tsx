import { NewTaskChat } from "@/components/chat/NewTaskChat";

type Props = {
  searchParams: Promise<{ prompt?: string; workspacePreset?: string }>;
};

export default async function NewTaskPage({ searchParams }: Props) {
  const { prompt, workspacePreset } = await searchParams;
  const initialWorkspacePreset =
    workspacePreset === "new-skill" ||
    workspacePreset === "datasource" ||
    workspacePreset === "rule-audit"
      ? workspacePreset
      : undefined;
  return (
    <NewTaskChat
      initialPrompt={prompt ?? ""}
      initialWorkspacePreset={initialWorkspacePreset}
    />
  );
}
