/**
 * Two-step sign-in for the test office admin: a tiny authenticator (RFC 6238
 * time-based codes, what phone authenticator apps compute), plus helpers to
 * set it up and to get a two-step ("aal2") sign-in token through the API.
 */
import { createHmac } from "node:crypto";

function base32(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("bad base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The 6-digit code an authenticator app would show now. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

const url = () => process.env.E2E_SUPABASE_URL!;
const key = () => process.env.E2E_SUPABASE_KEY!;

async function call(path: string, token: string | null, body: unknown) {
  const res = await fetch(`${url()}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: key(), "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Password sign-in token (aal1). */
export async function passwordToken(email: string, password: string): Promise<string> {
  return ((await call("token?grant_type=password", null, { email, password })) as { access_token: string }).access_token;
}

/** Sets up an authenticator for this account; returns its secret. */
export async function enrollTotp(email: string, password: string): Promise<string> {
  const token = await passwordToken(email, password);
  const f = (await call("factors", token, { factor_type: "totp", friendly_name: "E2E authenticator", issuer: "Petra Field Ops" })) as { id: string; totp: { secret: string } };
  await verify(token, f.id, f.totp.secret);
  return f.totp.secret;
}

async function verify(token: string, factorId: string, secret: string): Promise<string> {
  // A code works once; if this window's code was just used, wait for the next one.
  for (let attempt = 0; ; attempt++) {
    try {
      const c = (await call(`factors/${factorId}/challenge`, token, {})) as { id: string };
      const v = (await call(`factors/${factorId}/verify`, token, { challenge_id: c.id, code: totp(secret) })) as { access_token: string };
      return v.access_token;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1_000));
    }
  }
}

// Two-step tokens, reused within a test worker (valid for an hour; Supabase
// limits how many codes can be checked in a few minutes).
const tokens = new Map<string, Promise<string>>();

/** A two-step (aal2) sign-in token for an account with an authenticator. */
export function twoStepToken(email: string, password: string, secret: string): Promise<string> {
  let t = tokens.get(email);
  if (!t) {
    t = newTwoStepToken(email, password, secret);
    tokens.set(email, t);
    t.catch(() => tokens.delete(email));
  }
  return t;
}

async function newTwoStepToken(email: string, password: string, secret: string): Promise<string> {
  const token = await passwordToken(email, password);
  const user = (await (await fetch(`${url()}/auth/v1/user`, { headers: { apikey: key(), Authorization: `Bearer ${token}` } })).json()) as {
    factors?: { id: string; status: string }[];
  };
  const factor = user.factors?.find((f) => f.status === "verified");
  if (!factor) throw new Error("no authenticator set up for this account");
  return verify(token, factor.id, secret);
}
