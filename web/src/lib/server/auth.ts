import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import { cookies, headers } from "next/headers";
import { getAddress, verifyMessage, verifyTypedData, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { signInTypedData, type SignInScheme } from "@/lib/signIn";
import { appConfig } from "./config";
import { dataPath, db, nowSec } from "./db";

const COOKIE = "rb_session";
const SESSION_TTL = 7 * 24 * 3600;
const NONCE_TTL = 10 * 60;

function secret(): Buffer {
  if (process.env.SESSION_SECRET) return Buffer.from(process.env.SESSION_SECRET);
  // Persist a random secret next to the database so sessions survive restarts.
  const file = dataPath("session.secret");
  try {
    return fs.readFileSync(file);
  } catch {
    const s = crypto.randomBytes(32);
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createNonce(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const d = db();
  d.prepare("DELETE FROM auth_nonces WHERE created_at < ?").run(nowSec() - NONCE_TTL);
  d.prepare("INSERT INTO auth_nonces(nonce, created_at) VALUES(?, ?)").run(nonce, nowSec());
  return nonce;
}

export class AuthError extends Error {
  status = 401;
}

/**
 * Verifies an EIP-4361 message + signature and returns the signer. The message is signed either
 * with personal_sign (eip191) or wrapped in EIP-712 typed data for wallets without personal_sign.
 */
export async function verifySiwe(message: string, signature: Hex, scheme: SignInScheme = "eip191"): Promise<Address> {
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !parsed.domain) throw new AuthError("malformed sign-in message");

  const host = (await headers()).get("host");
  if (host && parsed.domain !== host) throw new AuthError(`sign-in message is for ${parsed.domain}, not ${host}`);
  if (parsed.chainId !== appConfig().chainId) throw new AuthError("sign-in message targets the wrong chain");
  if (parsed.expirationTime && parsed.expirationTime.getTime() < Date.now()) throw new AuthError("message expired");
  if (parsed.issuedAt && Math.abs(parsed.issuedAt.getTime() - Date.now()) > NONCE_TTL * 1000) {
    throw new AuthError("message issued too long ago");
  }

  const d = db();
  const row = d.prepare("SELECT created_at, used FROM auth_nonces WHERE nonce = ?").get(parsed.nonce) as
    | { created_at: number; used: number }
    | undefined;
  if (!row || row.used || row.created_at < nowSec() - NONCE_TTL) throw new AuthError("unknown or expired nonce");

  const ok =
    scheme === "eip712"
      ? await verifyTypedData({ address: parsed.address, signature, ...signInTypedData(parsed.chainId, message) })
      : await verifyMessage({ address: parsed.address, message, signature });
  if (!ok) throw new AuthError("signature does not match address");
  d.prepare("UPDATE auth_nonces SET used = 1 WHERE nonce = ?").run(parsed.nonce);
  return getAddress(parsed.address);
}

export async function startSession(address: Address): Promise<void> {
  ensureUser(address);
  const payload = Buffer.from(JSON.stringify({ a: address.toLowerCase(), e: nowSec() + SESSION_TTL })).toString(
    "base64url",
  );
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.RELEASEBOND_INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Lowercase address of the signed-in wallet, or null. */
export async function sessionAddress(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { a: string; e: number };
    if (e < nowSec()) return null;
    return a;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<string> {
  const a = await sessionAddress();
  if (!a) throw new AuthError("sign in with your wallet first");
  return a;
}

export function ensureUser(address: string): void {
  const a = address.toLowerCase();
  const d = db();
  const exists = d.prepare("SELECT 1 FROM users WHERE address = ?").get(a);
  if (exists) return;
  // Public researcher numbers start at 100 so they read like IDs, not ranks.
  const next = (d.prepare("SELECT COALESCE(MAX(researcher_no), 99) + 1 AS n FROM users").get() as { n: number }).n;
  d.prepare("INSERT INTO users(address, researcher_no, created_at) VALUES(?, ?, ?)").run(a, next, nowSec());
}
