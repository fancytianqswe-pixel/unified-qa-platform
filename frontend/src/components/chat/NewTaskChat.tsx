"use client";

import { useEffect } from "react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { useI18n } from "@/i18n/I18nProvider";
import { useChatStore } from "@/store/chatStore";

type Props = {
  initialPrompt?: string;
  /** 与 `ChatInput` 底部快捷药丸一致：预填技能卡片 + 引导话术 */
  initialWorkspacePreset?: "new-skill" | "datasource" | "rule-audit";
  sessionId?: string;
};

/**
 * NewTaskChat 组件/函数。
 */
export function NewTaskChat({ initialPrompt, initialWorkspacePreset, sessionId }: Props) {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const openSession = useChatStore((s) => s.openSession);
  const enterNewTaskWorkspace = useChatStore((s) => s.enterNewTaskWorkspace);
  const hasMessages = messages.length > 0;
  const isFormalConversation = !!(sessionId || currentSessionId);

  useEffect(() => {
    if (sessionId) {
      openSession(sessionId);
      return;
    }
    enterNewTaskWorkspace();
  }, [sessionId, openSession, enterNewTaskWorkspace]);

  return (
    <main
      className={`flex w-full flex-1 flex-col bg-[#FCFCFA] dark:bg-slate-950 ${
        hasMessages ? "min-h-0" : "min-h-0 items-center justify-center"
      }`}
    >
      {!hasMessages && !isFormalConversation ? (
        <section className="mb-10 flex flex-col items-center text-center">
          {/* 使用原生 img，避免 next/image 优化管道在部分环境下阻塞或失败 */}
          <img
            src="/brand/logo.png"
            alt={t("chat.logoAlt")}
            width={80}
            height={80}
            className="mb-4 h-20 w-20 rounded-3xl object-cover shadow-soft dark:ring-1 dark:ring-slate-700"
            loading="eager"
            decoding="async"
          />
          <h1 className="text-3xl font-medium text-gray-800 dark:text-slate-100">{t("chat.heroPrompt")}</h1>
        </section>
      ) : null}

      <MessageList />

      <div
        className={`w-full shrink-0 ${hasMessages ? "border-t border-[#FCFCFA] bg-[#FCFCFA] pt-1 dark:border-slate-800 dark:bg-slate-950" : ""}`}
      >
        <ChatInput
          initialPrompt={initialPrompt}
          initialWorkspacePreset={initialWorkspacePreset}
          mode={isFormalConversation ? "conversation" : "workspace"}
        />
      </div>
    </main>
  );
}

