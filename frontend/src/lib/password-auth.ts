import { createHash, pbkdf2Sync, timingSafeEqual } from "crypto";

const ITERATIONS = 120_000;
const KEYLEN = 32;
const DIGEST = "sha256";

function deriveSalt(userId: string): Buffer {
  return createHash("sha256").update(`xingyan-pbkdf2|${userId}`).digest();
}

/**
 * 使用与用户 id 绑定的确定性盐做 PBKDF2，避免每次归并时盐随机变化导致状态无限更新。
 * 仅用于本机内存态 / 演示；生产应换独立凭据库与更强策略。
 */
export function hashPasswordForUser(plain: string, userId: string): string {
  const salt = deriveSalt(userId);
  const hash = pbkdf2Sync(plain, salt, ITERATIONS, KEYLEN, DIGEST);
  return `v2$${ITERATIONS}$${encodeURIComponent(userId)}$${hash.toString("hex")}`;
}

export function verifyPasswordForUser(plain: string, stored: string): boolean {
  if (!stored || !plain || !stored.startsWith("v2$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const iter = Number(parts[1]);
  if (!Number.isFinite(iter) || iter < 1) return false;
  let userId: string;
  try {
    userId = decodeURIComponent(parts[2]!);
  } catch {
    return false;
  }
  const expectedHex = parts[3]!;
  if (!/^[0-9a-f]+$/i.test(expectedHex) || expectedHex.length !== KEYLEN * 2) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const salt = deriveSalt(userId);
  const hash = pbkdf2Sync(plain, salt, iter, expected.length, DIGEST);
  try {
    return timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}
