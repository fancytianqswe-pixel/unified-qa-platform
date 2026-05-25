/**
 * 纯函数：从用户正文猜测报账单号。无 Node 依赖，可供客户端 `chatStore` 与 BFF 共用。
 * 与 `minio-baodan-staging` 中 `BILL_NO_RE` 校验规则保持一致。
 */
const BILL_NO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/;

/**
 * 从用户本轮正文中猜测报账单号，供在未显式传 `context.baodanStageBillNo` 时仍能触发 BFF staging。
 * 当前实现：形如 `TYA` + 连续数字（与测试库一致）。
 */
export function tryParseBaodanBillNoFromUserText(text: string): string | undefined {
  const s = (text ?? "").trim();
  if (!s) return undefined;
  const ty = s.match(/\b(TYA\d{18,40})\b/gi);
  if (!ty) return undefined;
  for (const raw of ty) {
    const c = raw.toUpperCase();
    if (BILL_NO_RE.test(c)) return c;
  }
  return undefined;
}

/**
 * 从正文中按出现顺序提取所有合法报账单号（去重），用于阶段 B 等多单 staging。
 */
export function extractAllBaodanBillNosFromText(text: string, max = 8): string[] {
  const s = String(text ?? "");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of s.matchAll(/\b(TYA\d{18,40})\b/gi)) {
    if (out.length >= max) break;
    const c = (m[1] ?? "").toUpperCase();
    if (!BILL_NO_RE.test(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export type BaodanConversationSlice = {
  contextBaodanStageBillNo?: string;
  text?: string;
  conversationHistory?: Array<{ role?: string; content?: string }>;
  maxBills?: number;
};

/**
 * 与 BFF `resolveBaodanBillNosForStaging` 同源：合并 context、本轮正文、历史消息中的报账单号（去重、上限）。
 * 纯函数，可在浏览器与 Node 共用；供 `chatStore` 传 `context.baodanStageBillNo` 与 BFF 拉单列表对齐。
 */
export function resolveBaodanBillNosFromConversation(input: BaodanConversationSlice): string[] {
  const limit = Math.min(10, Math.max(1, input.maxBills ?? 5));
  const out: string[] = [];
  const push = (token: string) => {
    const n = token.trim();
    if (!BILL_NO_RE.test(n) || out.includes(n) || out.length >= limit) return;
    out.push(n);
  };
  const pushAllFromText = (t: string) => {
    const room = limit - out.length;
    if (room <= 0) return;
    for (const x of extractAllBaodanBillNosFromText(t, room)) {
      if (out.length >= limit) break;
      if (!out.includes(x)) out.push(x);
    }
  };

  const ctxRaw = input.contextBaodanStageBillNo?.trim();
  if (ctxRaw) {
    for (const piece of ctxRaw.split(/[\s,;，；]+/)) {
      const p = piece.trim();
      if (p) push(p);
    }
  }
  pushAllFromText(input.text ?? "");

  const hist = input.conversationHistory;
  if (Array.isArray(hist)) {
    for (let i = hist.length - 1; i >= 0 && out.length < limit; i--) {
      const m = hist[i];
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      pushAllFromText(typeof m.content === "string" ? m.content : "");
    }
  }
  return out;
}
