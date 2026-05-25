const COOKIE_NAME = "xingyan_session";

function getSecret(): string {
  return (process.env.SESSION_SECRET ?? "xingyan-dev-session-secret-change-in-production").trim();
}

function bytesToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8ToB64url(s: string): string {
  const enc = new TextEncoder();
  return bytesToB64url(enc.encode(s).buffer);
}

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToUtf8(b64url: string): string {
  return new TextDecoder().decode(b64urlToBytes(b64url));
}

export type SessionPayload = {
  sub: string;
  account: string;
  name: string;
  role: string;
  exp: number;
};

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSessionPayload(payload: SessionPayload): Promise<string> {
  const body = utf8ToB64url(JSON.stringify(payload));
  const key = await importHmacKey(getSecret());
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${bytesToB64url(sig)}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const sigPart = parts.pop()!;
  const body = parts.join(".");
  if (!body || !sigPart) return null;
  try {
    const key = await importHmacKey(getSecret());
    const sigBuf = new Uint8Array(b64urlToBytes(sigPart));
    const ok = await crypto.subtle.verify("HMAC", key, sigBuf, new TextEncoder().encode(body));
    if (!ok) return null;
    const json = JSON.parse(b64urlToUtf8(body)) as SessionPayload;
    if (!json || typeof json.exp !== "number" || typeof json.account !== "string") return null;
    if (Date.now() / 1000 > json.exp) return null;
    return json;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
