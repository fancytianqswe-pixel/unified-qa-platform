"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionAccess } from "@/components/layout/SessionAccessContext";
import { useChatStore } from "@/store/chatStore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CornerDownLeft,
  Database,
  Mic,
  Plus,
  Puzzle,
  Search,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
} from "lucide-react";
import { ContentBlock } from "@/components/chat/types";
import type { Skill } from "@/components/skills/types";
import { loadLocalSkills } from "@/lib/skill-local-storage";
import { normalizeSkillCreatorDisplayName } from "@/lib/skill-creator-display";
import { fetchSkillsApiListFromNetwork, getCachedSkillsApiList } from "@/lib/skills-api-cache";
import { useI18n } from "@/i18n/I18nProvider";
import { displaySkillDescriptionForUi, displaySkillNameForUi, displaySkillSamplePromptForUi } from "@/lib/skill-builtin-i18n";
import {
  CHAT_MODEL_AUTO_SENTINEL,
  resolveEffectiveChatModel,
} from "@/lib/chat-turn-model-config";
import {
  contentBlockMatchesQuickChip,
  getQuickChipPrompt,
  getQuickChipSkillLabel,
  matchingQuickChipForHermesSkill,
  pickHermesAlignedSkillForChip,
  quickChipMatchNames,
  skillCardDisplayName,
  type BuiltinQuickChipId,
} from "@/lib/quick-chip-builtin";

/** 新任务页底部快捷入口 id（与 `?workspacePreset=` 语义对齐） */
const QUICK_CHIP_IDS: readonly BuiltinQuickChipId[] = ["datasource", "rule-audit", "new-skill"];

type QuickChipId = BuiltinQuickChipId;

function mergeApiAndLocalSkills(api: Skill[], local: Skill[]): Skill[] {
  const seen = new Set(api.map((s) => s.id));
  const out = api.map((s) => ({
    ...s,
    name: normalizeSkillCreatorDisplayName(s.name, s.id),
  }));
  for (const s of local) {
    if (s?.id && !seen.has(s.id)) {
      seen.add(s.id);
      out.push({
        ...s,
        name: normalizeSkillCreatorDisplayName(s.name, s.id),
      });
    }
  }
  return out;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onend?: () => void;
      onerror?: () => void;
      onresult: (event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void;
      start: () => void;
      stop: () => void;
    };
  }
}

type Props = {
  initialPrompt?: string;
  /** 打开页即预填与底部快捷药丸相同的技能卡片 + 话术（如 `?workspacePreset=new-skill` / `datasource` / `rule-audit`） */
  initialWorkspacePreset?: "new-skill" | "datasource" | "rule-audit";
  mode?: "workspace" | "conversation";
};

/**
 * ChatInput 富文本输入组件，支持文本+技能卡片+文件卡片混排。
 */
export function ChatInput({
  initialPrompt = "",
  initialWorkspacePreset,
  mode = "workspace",
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setDatasourceWizardActive = useChatStore((s) => s.setDatasourceWizardActive);
  const setDataRuleAuditWizardActive = useChatStore((s) => s.setDataRuleAuditWizardActive);
  const composerInsertRequest = useChatStore((s) => s.composerInsertRequest);
  const clearComposerInsertRequest = useChatStore((s) => s.clearComposerInsertRequest);
  const isLoading = useChatStore((s) => s.isLoading);
  const messages = useChatStore((s) => s.messages);
  const renameHistorySession = useChatStore((s) => s.renameHistorySession);
  const modelConfigs = useChatStore((s) => s.modelConfigs);
  const selectedChatModel = useChatStore((s) => s.selectedChatModel);
  const setSelectedChatModel = useChatStore((s) => s.setSelectedChatModel);
  const sessionAccess = useSessionAccess();
  const [persistHydrated, setPersistHydrated] = useState(
    () => useChatStore.persist?.hasHydrated?.() ?? false,
  );

  const quickActionChipsVisible = useMemo(() => {
    const all = [...QUICK_CHIP_IDS];
    if (!sessionAccess) return all;
    if (!sessionAccess.menuKeys.includes("menu-new-task")) return [];
    const buttons = sessionAccess.buttonPermissions["menu-new-task"] ?? [];
    if (!buttons.includes("技能")) return [];
    return all;
  }, [sessionAccess]);

  const [isRecording, setIsRecording] = useState(false);
  const [showSkillPanel, setShowSkillPanel] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  useEffect(() => {
    if (useChatStore.persist.hasHydrated()) {
      setPersistHydrated(true);
      return;
    }
    return useChatStore.persist.onFinishHydration(() => setPersistHydrated(true));
  }, []);

  const savedModelNames = useMemo(
    () => modelConfigs.map((item) => item.modelName).filter(Boolean),
    [modelConfigs],
  );
  const modelOptions = useMemo(
    () => [CHAT_MODEL_AUTO_SENTINEL, ...savedModelNames],
    [savedModelNames],
  );
  const modelStatusMap = useMemo(
    () =>
      modelConfigs.reduce<Record<string, { available: boolean; syncStatus: string }>>((acc, item) => {
        acc[item.modelName] = {
          available: item.available !== false,
          syncStatus: item.syncStatus ?? "synced",
        };
        return acc;
      }, {}),
    [modelConfigs],
  );
  const effectiveModel = resolveEffectiveChatModel(
    selectedChatModel,
    savedModelNames,
    persistHydrated,
  );

  useEffect(() => {
    if (!persistHydrated) return;
    if (selectedChatModel === CHAT_MODEL_AUTO_SENTINEL) return;
    if (savedModelNames.includes(selectedChatModel)) return;
    if (savedModelNames.length === 0) return;
    setSelectedChatModel(CHAT_MODEL_AUTO_SENTINEL);
  }, [persistHydrated, selectedChatModel, savedModelNames, setSelectedChatModel]);

  const [showModelMenu, setShowModelMenu] = useState(false);
  const [fileUploadBusy, setFileUploadBusy] = useState(false);
  const [recognition, setRecognition] = useState<null | { stop: () => void }>(null);
  const [editorHasContent, setEditorHasContent] = useState(
    !!initialPrompt.trim() ||
      initialWorkspacePreset === "new-skill" ||
      initialWorkspacePreset === "datasource" ||
      initialWorkspacePreset === "rule-audit",
  );

  const editableRef = useRef<HTMLDivElement | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const skillSearchRef = useRef<HTMLInputElement | null>(null);
  /** 防止连续点药丸时，较晚返回的技能列表把卡片写错 */
  const quickChipApplyGenRef = useRef(0);

  const [skillCatalog, setSkillCatalog] = useState<Skill[]>([]);
  const [skillCatalogStatus, setSkillCatalogStatus] = useState<"idle" | "loading" | "error">("idle");
  const [skillActiveIndex, setSkillActiveIndex] = useState(0);

  const loadSkillCatalog = useCallback(async (): Promise<Skill[]> => {
    setSkillCatalogStatus("loading");
    const cached = getCachedSkillsApiList();
    if (cached?.length) {
      const merged = mergeApiAndLocalSkills(cached, loadLocalSkills());
      setSkillCatalog(merged);
      setSkillCatalogStatus("idle");
      void fetchSkillsApiListFromNetwork().then(({ list, ok }) => {
        if (ok) {
          const fresh = mergeApiAndLocalSkills(list, loadLocalSkills());
          setSkillCatalog(fresh);
          setSkillCatalogStatus("idle");
        }
      });
      return merged;
    }
    try {
      const { list, ok } = await fetchSkillsApiListFromNetwork();
      const merged = mergeApiAndLocalSkills(ok ? list : [], loadLocalSkills());
      setSkillCatalog(merged);
      setSkillCatalogStatus(ok ? "idle" : "error");
      return merged;
    } catch {
      const merged = mergeApiAndLocalSkills([], loadLocalSkills());
      setSkillCatalog(merged);
      setSkillCatalogStatus("error");
      return merged;
    }
  }, []);

  useEffect(() => {
    if (!showSkillPanel) return;
    void loadSkillCatalog();
    setSkillActiveIndex(0);
    const t = window.setTimeout(() => skillSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [showSkillPanel, loadSkillCatalog]);

  useEffect(() => {
    setSkillActiveIndex(0);
  }, [skillQuery]);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    if (!q) return skillCatalog;
    return skillCatalog.filter((s) => {
      const hay = `${s.name} ${s.description} ${s.author} ${s.samplePrompt ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [skillCatalog, skillQuery]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { blocks, plainText } = extractBlocksFromEditor();
    if (!blocks.length && !plainText.trim()) return;
    const inputText = plainText.trim();
    const isFirstUserMessage = !messages.some((m) => m.role === "user");
    const st = useChatStore.getState();
    const guideForTitle = st.datasourceWizardActive;
    const auditGuideForTitle = st.dataRuleAuditWizardActive;
    clearEditor();
    const sessionId = await sendMessage({ text: inputText, blocks, model: effectiveModel });
    router.push(`/conversation/${encodeURIComponent(sessionId)}`);

    if (isFirstUserMessage) {
      const hasSkillCreator = blocks.some((b) => contentBlockMatchesQuickChip(b, "new-skill", t));
      const hasAuditChip = blocks.some((b) => contentBlockMatchesQuickChip(b, "rule-audit", t));
      if (auditGuideForTitle || hasAuditChip) {
        renameHistorySession(sessionId, t("chat.sessionTitle.ruleAudit"));
      } else if (guideForTitle) {
        renameHistorySession(sessionId, t("chat.sessionTitle.datasourceWizard"));
      } else if (hasSkillCreator) {
        renameHistorySession(sessionId, t("chat.sessionTitle.newSkill"));
      } else {
        void (async () => {
          const pickedConfig =
            effectiveModel === CHAT_MODEL_AUTO_SENTINEL
              ? modelConfigs[0]
              : modelConfigs.find((item) => item.modelName === effectiveModel);

          try {
            const res = await fetch("/api/chat/session-title", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: inputText,
                modelConfig: pickedConfig
                  ? {
                      modelName: pickedConfig.modelName,
                      baseUrl: pickedConfig.baseUrl,
                      apiKey: pickedConfig.apiKey,
                    }
                  : undefined,
              }),
            });
            const data = (await res.json()) as { title?: string };
            if (data.title) {
              renameHistorySession(sessionId, data.title);
            } else {
              renameHistorySession(sessionId, t("chat.sessionTitle.unnamed"));
            }
          } catch {
            renameHistorySession(sessionId, t("chat.sessionTitle.unnamed"));
          }
        })();
      }
    }
  }

  function getPromptBySkill(skillName: string) {
    const trimmed = skillName.trim();
    const chip = QUICK_CHIP_IDS.find((id) => quickChipMatchNames(id, t).includes(trimmed));
    return chip ? getQuickChipPrompt(chip, t) : "";
  }

  function createCardNode(
    kind: "skill" | "file",
    name: string,
    skillId?: string,
    fileMeta?: { attachmentId: string; storedFileName: string },
  ) {
    const el = document.createElement("span");
    el.setAttribute("contenteditable", "false");
    el.dataset.blockType = kind === "skill" ? "skill_card" : "file_card";
    el.dataset.name = name;
    if (kind === "file" && fileMeta?.attachmentId && fileMeta.storedFileName) {
      el.dataset.attachmentId = fileMeta.attachmentId;
      el.dataset.storedFileName = fileMeta.storedFileName;
    }
    if (kind === "skill" && skillId?.trim()) {
      el.dataset.skillId = skillId.trim();
    }
    el.className =
      kind === "skill"
        ? "mx-0.5 inline-flex shrink-0 items-center gap-1.5 align-middle rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-sm leading-5 text-blue-700"
        : "mx-0.5 inline-flex shrink-0 items-center gap-1.5 align-middle rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-sm leading-5 text-amber-700";
    el.textContent = kind === "skill" ? `✦ ${name}` : `📄 ${name}`;
    return el;
  }

  function placeCaretAfter(node: Node) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAtEnd(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function saveSelectionRange() {
    const editor = editableRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
    selectionRangeRef.current = range.cloneRange();
  }

  function restoreSelectionRange() {
    const editor = editableRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    if (!selectionRangeRef.current) {
      placeCaretAtEnd(editor);
      return;
    }
    try {
      selection.removeAllRanges();
      selection.addRange(selectionRangeRef.current);
    } catch {
      placeCaretAtEnd(editor);
    }
  }

  function insertNodeAtCursor(node: Node) {
    const editor = editableRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelectionRange();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editor.appendChild(node);
      placeCaretAfter(node);
      return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    placeCaretAfter(node);
    saveSelectionRange();
  }

  function insertTextAtCursor(text: string) {
    if (!text) return;
    insertNodeAtCursor(document.createTextNode(text));
  }

  function removeExistingSkillCards() {
    const editor = editableRef.current;
    if (!editor) return;
    const nodes = editor.querySelectorAll<HTMLElement>('[data-block-type="skill_card"]');
    nodes.forEach((n) => n.remove());
  }

  function insertSkillCardAtCursor(name: string, skillId?: string) {
    removeExistingSkillCards();
    insertNodeAtCursor(
      createCardNode("skill", normalizeSkillCreatorDisplayName(name, skillId), skillId),
    );
  }

  /** contenteditable 下 Enter 产生的并列 DIV/P（含嵌套在外层 DIV 内的多行） */
  function isEditorRootBlockLine(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    if (el.dataset?.blockType) return false;
    return /^(DIV|P)$/i.test(el.tagName);
  }

  function walkNode(node: Node, blocks: ContentBlock[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text) return;
      blocks.push({ type: "text", text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const blockType = el.dataset.blockType;
    if (blockType === "skill_card") {
      const sid = el.dataset.skillId?.trim();
      const rawName = el.dataset.name ?? "";
      blocks.push({
        type: "skill_card",
        name: normalizeSkillCreatorDisplayName(rawName, sid),
        ...(sid ? { skillId: sid } : {}),
      });
      return;
    }
    if (blockType === "file_card") {
      const aid = el.dataset.attachmentId?.trim();
      const sfn = el.dataset.storedFileName?.trim();
      blocks.push({
        type: "file_card",
        name: el.dataset.name ?? "",
        ...(aid && sfn ? { attachmentId: aid, storedFileName: sfn } : {}),
      });
      return;
    }
    if (el.tagName === "BR") {
      blocks.push({ type: "text", text: "\n" });
      return;
    }
    const children = Array.from(el.childNodes);
    children.forEach((child, i) => {
      walkNode(child, blocks);
      const next = children[i + 1];
      if (next && isEditorRootBlockLine(child) && isEditorRootBlockLine(next)) {
        blocks.push({ type: "text", text: "\n" });
      }
    });
  }

  function normalizeBlocks(blocks: ContentBlock[]) {
    const merged: ContentBlock[] = [];
    for (const block of blocks) {
      if (block.type === "text") {
        const prev = merged[merged.length - 1];
        if (prev?.type === "text") {
          prev.text += block.text;
        } else {
          merged.push({ ...block });
        }
      } else {
        merged.push(block);
      }
    }
    return merged.filter((b) =>
      b.type === "text" ? b.text.length > 0 : b.type === "skill_card" || b.type === "file_card" ? !!b.name : true,
    );
  }

  function extractBlocksFromEditor() {
    const editor = editableRef.current;
    const blocks: ContentBlock[] = [];
    if (!editor) return { blocks, plainText: "" };
    const children = Array.from(editor.childNodes);
    children.forEach((n, i) => {
      walkNode(n, blocks);
      const next = children[i + 1];
      if (next && isEditorRootBlockLine(n) && isEditorRootBlockLine(next)) {
        blocks.push({ type: "text", text: "\n" });
      }
    });
    const normalized = normalizeBlocks(blocks);
    const plainText = normalized
      .map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "skill_card") return `[${b.name}]`;
        return `[文件:${b.name}]`;
      })
      .join("\n")
      .trim();
    return { blocks: normalized, plainText };
  }

  function syncEditorState() {
    const { blocks, plainText } = extractBlocksFromEditor();
    setEditorHasContent(blocks.length > 0 || !!plainText.trim());
  }

  /** `isLoading` 从 true 回落后根据 DOM 重算可发送态，避免与 store 不同步时发送钮误灰 */
  useEffect(() => {
    if (isLoading) return;
    const id = window.requestAnimationFrame(() => syncEditorState());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖加载态与模式，避免把每次 render 的闭包函数塞进 deps
  }, [isLoading, mode]);

  /** 助手追问标签：只写入输入框，不直接发消息 */
  useEffect(() => {
    if (!composerInsertRequest) return;
    const { text } = composerInsertRequest;
    const id = window.requestAnimationFrame(() => {
      const t = text.replace(/\r\n/g, "\n").trim();
      if (!t) {
        clearComposerInsertRequest();
        return;
      }
      const editor = editableRef.current;
      if (!editor) {
        clearComposerInsertRequest();
        return;
      }
      editor.focus();
      restoreSelectionRange();
      const { plainText } = extractBlocksFromEditor();
      if (plainText.trim()) insertTextAtCursor(`\n\n${t}`);
      else insertTextAtCursor(t);
      syncEditorState();
      placeCaretAtEnd(editor);
      saveSelectionRange();
      clearComposerInsertRequest();
    });
    return () => window.cancelAnimationFrame(id);
  }, [composerInsertRequest?.nonce, clearComposerInsertRequest]);

  function clearEditor() {
    const editor = editableRef.current;
    if (!editor) return;
    editor.innerHTML = "";
    setEditorHasContent(false);
  }

  function syncQuickChipSkillCardFromCatalog(chip: QuickChipId, catalog: Skill[]) {
    const editor = editableRef.current;
    if (!editor) return;
    const card = editor.querySelector<HTMLElement>('[data-block-type="skill_card"]');
    if (!card) return;
    const picked = pickHermesAlignedSkillForChip(catalog, chip, t);
    const label = skillCardDisplayName(picked, t);
    if ((card.dataset.skillId ?? "").trim() === picked.id.trim() && (card.dataset.name ?? "") === label) {
      return;
    }
    card.dataset.name = label;
    if (picked.id) card.dataset.skillId = picked.id;
    card.textContent = `✦ ${label}`;
    syncEditorState();
  }

  /**
   * 底部「配置数据源 / 新技能」药丸：先同步写入内置或已缓存列表中的技能与话术，再后台请求 `/api/skills/list`
   * 对齐 Hermes 的 `h{n}:…` id，避免首包前阻塞 1～2 秒才出现输入区内容。
   */
  function applyQuickChipPreset(chip: QuickChipId) {
    const gen = ++quickChipApplyGenRef.current;
    const immediatePick = pickHermesAlignedSkillForChip(skillCatalog, chip, t);
    const cardLabel = skillCardDisplayName(immediatePick, t);
    clearEditor();
    setDatasourceWizardActive(chip === "datasource");
    setDataRuleAuditWizardActive(chip === "rule-audit");
    insertSkillCardAtCursor(cardLabel, immediatePick.id);
    insertTextAtCursor(` ${getQuickChipPrompt(chip, t)}`);
    syncEditorState();
    void (async () => {
      const cached = getCachedSkillsApiList();
      if (cached?.length) {
        const merged = mergeApiAndLocalSkills(cached, loadLocalSkills());
        if (quickChipApplyGenRef.current !== gen) return;
        setSkillCatalog(merged);
        syncQuickChipSkillCardFromCatalog(chip, merged);
        const { list, ok } = await fetchSkillsApiListFromNetwork();
        if (quickChipApplyGenRef.current !== gen || !ok) return;
        const fresh = mergeApiAndLocalSkills(list, loadLocalSkills());
        setSkillCatalog(fresh);
        syncQuickChipSkillCardFromCatalog(chip, fresh);
        return;
      }
      const { list, ok } = await fetchSkillsApiListFromNetwork();
      const merged = mergeApiAndLocalSkills(ok ? list : [], loadLocalSkills());
      if (quickChipApplyGenRef.current !== gen) return;
      setSkillCatalog(merged);
      syncQuickChipSkillCardFromCatalog(chip, merged);
    })();
  }

  useEffect(() => {
    if (initialWorkspacePreset === "new-skill") {
      applyQuickChipPreset("new-skill");
      return;
    }
    if (initialWorkspacePreset === "datasource") {
      applyQuickChipPreset("datasource");
      return;
    }
    if (initialWorkspacePreset === "rule-audit") {
      applyQuickChipPreset("rule-audit");
      return;
    }
    if (initialPrompt.trim()) {
      insertTextAtCursor(initialPrompt);
      syncEditorState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      const native = e.nativeEvent;
      if ("isComposing" in native && native.isComposing) return;
      const { blocks, plainText } = extractBlocksFromEditor();
      const hasContent = blocks.length > 0 || !!plainText.trim();
      if (hasContent && !isLoading) {
        e.preventDefault();
        const ev = { preventDefault: () => {} } as FormEvent;
        void onSubmit(ev);
      }
    }
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    window.requestAnimationFrame(() => syncEditorState());
  }

  async function onAttachFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    restoreSelectionRange();
    setFileUploadBusy(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/chat/attachments", { method: "POST", body: fd });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          attachmentId?: string;
          name?: string;
          storedFileName?: string;
        };
        if (!res.ok || !j.ok || !j.attachmentId || !j.storedFileName) {
          window.alert(j.message || t("chat.uploadFail", { status: String(res.status) }));
          continue;
        }
        insertNodeAtCursor(
          createCardNode("file", (j.name || f.name).trim() || f.name, undefined, {
            attachmentId: j.attachmentId,
            storedFileName: j.storedFileName,
          }),
        );
        syncEditorState();
      }
    } finally {
      setFileUploadBusy(false);
    }
  }

  function onChipClick(chip: QuickChipId) {
    applyQuickChipPreset(chip);
  }

  function applySkillPick(skill: Skill) {
    clearEditor();
    const sid = String(skill.id ?? "").toLowerCase();
    const isAuditSkill =
      String(skill.name ?? "").trim() === "数据规则审核助手" || sid.includes("data-rule-audit-skill");
    setDataRuleAuditWizardActive(isAuditSkill);
    setDatasourceWizardActive(!isAuditSkill && matchingQuickChipForHermesSkill(skill, t) === "datasource");
    const cardLabel = skillCardDisplayName(skill, t);
    insertSkillCardAtCursor(cardLabel, skill.id);
    const chip = matchingQuickChipForHermesSkill(skill, t);
    const fromChip = chip ? getQuickChipPrompt(chip, t) : "";
    const fallback =
      displaySkillSamplePromptForUi(skill, t).trim() ||
      (skill.samplePrompt ?? "").trim() ||
      (skill.description ?? "").trim();
    const text = (fromChip || getPromptBySkill(skill.name) || fallback).trim();
    if (text) insertTextAtCursor(` ${text}`);
    syncEditorState();
    setShowSkillPanel(false);
    setSkillQuery("");
  }

  function onSkillPanelKeyDown(e: React.KeyboardEvent) {
    if (!showSkillPanel) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!filteredSkills.length) return;
      setSkillActiveIndex((i) => Math.min(i + 1, filteredSkills.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSkillActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = filteredSkills[skillActiveIndex];
      if (s) applySkillPick(s);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSkillPanel(false);
      setSkillQuery("");
    }
  }

  function toggleVoice() {
    if (isRecording && recognition) {
      recognition.stop();
      return;
    }
    const Recognition = window.webkitSpeechRecognition;
    if (!Recognition) {
      alert(t("chat.voiceUnsupported"));
      return;
    }
    const rec = new Recognition();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    setIsRecording(true);
    rec.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }
      insertTextAtCursor(transcript.trim());
      syncEditorState();
    };
    rec.onend = () => {
      setIsRecording(false);
      setRecognition(null);
    };
    rec.onerror = () => {
      setIsRecording(false);
      setRecognition(null);
    };
    setRecognition(rec);
    rec.start();
  }

  const canSend = editorHasContent && !isLoading && !fileUploadBusy;
  const isFormalConversation = mode === "conversation";

  function renderSkillPickerPanelContent() {
    return (
      <>
        <div className="flex items-center gap-1.5 border-b border-[#EEEEEE] px-2.5 py-1.5 dark:border-slate-600">
          <Search className="size-3.5 shrink-0 text-[#999] dark:text-slate-500" strokeWidth={2} aria-hidden />
          <input
            ref={skillSearchRef}
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
            onKeyDown={onSkillPanelKeyDown}
            placeholder={t("chat.skillSearchPlaceholder")}
            className="skill-picker-search min-h-0 min-w-0 flex-1 border-0 bg-transparent py-0.5 text-sm leading-5 text-[#333] outline-none ring-0 placeholder:text-[#BBB] focus:border-transparent focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 dark:text-slate-200 dark:placeholder:text-slate-500"
            aria-autocomplete="list"
          />
        </div>

        <div className="max-h-64 overflow-y-auto py-0.5">
          {skillCatalogStatus === "loading" && skillCatalog.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[#888] dark:text-slate-400">
              {t("chat.skillListLoading")}
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[#888] dark:text-slate-400">
              {skillCatalogStatus === "error" ? t("chat.skillListErrorHint") : t("chat.skillListEmpty")}
            </div>
          ) : (
            filteredSkills.map((skill, idx) => (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={idx === skillActiveIndex}
                onMouseEnter={() => setSkillActiveIndex(idx)}
                onClick={() => applySkillPick(skill)}
                className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors !rounded-none !font-normal focus-visible:outline-none focus-visible:ring-0 ${
                  idx === skillActiveIndex
                    ? "!bg-[#F5F5F5] !text-[#333] hover:!bg-[#F5F5F5] dark:!bg-slate-700 dark:!text-slate-100 dark:hover:!bg-slate-700"
                    : "!bg-white !text-[#333] hover:!bg-[#FAFAFA] dark:!bg-slate-900 dark:!text-slate-100 dark:hover:!bg-slate-800"
                }`}
              >
                <Puzzle className="size-4 shrink-0 text-[#999] dark:text-slate-500" strokeWidth={1.75} aria-hidden />
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 text-[15px] font-medium leading-snug text-[#333] dark:text-slate-100">
                    {displaySkillNameForUi(skill, t)}
                    {skill.deprecated ? (
                      <span className="font-normal text-[#888] dark:text-slate-400">
                        {" "}
                        ({t("chat.skillDeprecated")})
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-sm leading-snug text-[#888] dark:text-slate-400">
                    {(displaySkillDescriptionForUi(skill, t) || "").replace(/\s+/g, " ").trim() || "—"}
                  </span>
                </div>
                {idx === skillActiveIndex ? (
                  <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap text-xs text-[#888] dark:text-slate-500 sm:inline-flex">
                    {t("chat.skillEnterHint")}
                    <CornerDownLeft className="size-3.5" aria-hidden />
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-[#EEEEEE] dark:border-slate-600">
          <Link
            href="/skills-center"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[#333] transition-colors hover:bg-[#FAFAFA] dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => setShowSkillPanel(false)}
          >
            <SlidersHorizontal className="size-4 shrink-0 text-[#999] dark:text-slate-500" strokeWidth={1.75} aria-hidden />
            <span className="flex-1">{t("chat.skillManageLink")}</span>
            <ChevronRight className="size-4 shrink-0 text-[#CCC] dark:text-slate-600" aria-hidden />
          </Link>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="relative z-10 mx-auto w-full max-w-4xl">
      {showSkillPanel && isFormalConversation ? (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 w-full max-w-4xl -translate-x-1/2 overflow-hidden rounded-[10px] border border-[#EEEEEE] bg-white ring-1 ring-black/[0.04] dark:border-slate-600 dark:bg-slate-900 dark:ring-white/10"
          role="listbox"
          aria-label={t("chat.ariaPickSkill")}
        >
          {renderSkillPickerPanelContent()}
        </div>
      ) : null}
      <div className="overflow-visible rounded-[28px] border border-[#E0E0E0] bg-white p-3 shadow-none ring-0 outline-none transition-colors focus-within:border-[#D0D0D0] focus-within:ring-0 focus-within:outline-none dark:border-slate-600 dark:bg-slate-900 focus-within:dark:border-slate-500">
        <div
          className={`relative rounded-xl bg-white px-2 py-1 ring-0 outline-none dark:bg-slate-900 ${
            mode === "workspace" ? "min-h-[132px]" : "min-h-[44px]"
          }`}
          onClick={() => editableRef.current?.focus()}
        >
          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              syncEditorState();
              saveSelectionRange();
            }}
            onFocus={saveSelectionRange}
            onMouseUp={saveSelectionRange}
            onKeyUp={saveSelectionRange}
            onKeyDown={onInputKeyDown}
            className={`min-h-0 w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words border-0 bg-white text-[15px] leading-7 text-gray-700 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none dark:bg-slate-900 dark:text-slate-200 [&_[data-block-type]]:inline-flex [&_[data-block-type]]:align-middle ${
              mode === "workspace" ? "min-h-[96px] max-h-[112px]" : "min-h-7 max-h-[112px]"
            }`}
          />
        </div>

        <div className="mt-1 flex items-center gap-1 border-t border-gray-100/90 pt-2 dark:border-slate-700">
          <label
            className={`rounded-full p-2 text-gray-500 dark:text-slate-400 ${isLoading || fileUploadBusy ? "cursor-not-allowed opacity-50" : "hover:bg-gray-100 dark:hover:bg-slate-800"}`}
            title={fileUploadBusy ? t("chat.uploading") : t("admin.permBtn.uploadAttachment")}
          >
            <input
              type="file"
              className="hidden"
              multiple
              onChange={(ev) => void onAttachFile(ev)}
              disabled={isLoading || fileUploadBusy}
            />
            <Plus className="size-5" />
          </label>

          <div className="relative shrink-0">
            <button
              type="button"
              disabled={isLoading}
              className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() =>
                setShowSkillPanel((v) => {
                  const next = !v;
                  if (!next) setSkillQuery("");
                  return next;
                })
              }
              title={t("admin.permBtn.skill")}
            >
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-4" />
                {t("admin.permBtn.skill")}
              </span>
            </button>

            {showSkillPanel && !isFormalConversation ? (
              <div
                className="absolute left-0 top-full z-50 mt-1 w-[min(calc(100vw-2rem),42rem)] max-w-2xl overflow-hidden rounded-[10px] border border-[#EEEEEE] bg-white ring-1 ring-black/[0.04] dark:border-slate-600 dark:bg-slate-900 dark:ring-white/10"
                role="listbox"
                aria-label={t("chat.ariaPickSkill")}
              >
                {renderSkillPickerPanelContent()}
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                disabled={isLoading}
                className="rounded-full bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                onClick={() => setShowModelMenu((v) => !v)}
                title={t("admin.permBtn.modelSelect")}
              >
                <span className="inline-flex items-center gap-1">
                  {effectiveModel === CHAT_MODEL_AUTO_SENTINEL ? t("chat.modelAuto") : effectiveModel}
                  <ChevronDown className="size-4" />
                </span>
              </button>
              {showModelMenu ? (
                <div className="absolute bottom-11 left-0 z-20 w-44 rounded-xl border border-gray-100 bg-white p-1 dark:border-slate-600 dark:bg-slate-900">
                  {modelOptions.map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={m !== CHAT_MODEL_AUTO_SENTINEL && modelStatusMap[m] && !modelStatusMap[m].available}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${
                        effectiveModel === m
                          ? "bg-blue-600 font-medium text-white"
                          : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                      onClick={() => {
                        setSelectedChatModel(m);
                        setShowModelMenu(false);
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {m === CHAT_MODEL_AUTO_SENTINEL ? t("chat.modelAuto") : m}
                        {m !== CHAT_MODEL_AUTO_SENTINEL && modelStatusMap[m] ? (
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              modelStatusMap[m].syncStatus === "failed"
                                ? "bg-rose-500"
                                : modelStatusMap[m].syncStatus === "pending"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            title={
                              modelStatusMap[m].syncStatus === "failed"
                                ? t("model.syncFailed")
                                : modelStatusMap[m].syncStatus === "pending"
                                  ? t("model.syncPending")
                                  : t("model.synced")
                            }
                          />
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              disabled={isLoading}
              className={`rounded-full bg-white p-2 transition-colors hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 ${
                isRecording ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-slate-400"
              }`}
              onClick={toggleVoice}
              title={isRecording ? t("chat.stopRecording") : t("admin.permBtn.voice")}
            >
              {isRecording ? <StopCircle className="size-5" /> : <Mic className="size-5" />}
            </button>

            <button
              type="submit"
              disabled={!canSend}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800 disabled:bg-gray-200 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              title={t("admin.permBtn.send")}
            >
              <ArrowUp className="size-5" />
            </button>
          </div>
        </div>
      </div>
      </div>

      {!isFormalConversation && quickActionChipsVisible.length > 0 ? (
        <div className="relative z-0 mx-auto flex w-full max-w-3xl flex-wrap justify-center gap-3 pb-1">
          {quickActionChipsVisible.map((chip) => (
            <button
              key={chip}
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-[#E5E5E5] bg-white px-5 py-2.5 text-[15px] font-medium text-[#333] transition-colors hover:border-[#D8D8D8] hover:bg-[#FAFAFA] active:scale-[0.99] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-700"
              onClick={() => onChipClick(chip)}
            >
              {chip === "datasource" ? (
                <Database className="size-[18px] shrink-0 text-sky-600" strokeWidth={2} aria-hidden />
              ) : chip === "rule-audit" ? (
                <ClipboardCheck className="size-[18px] shrink-0 text-emerald-600" strokeWidth={2} aria-hidden />
              ) : (
                <Sparkles className="size-[18px] shrink-0 text-violet-600" strokeWidth={2} aria-hidden />
              )}
              {getQuickChipSkillLabel(chip, t)}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

