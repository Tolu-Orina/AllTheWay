import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db } from "./firestore.js";

/**
 * One-time codes for email verification and password reset.
 *
 * Rules that matter, all enforced server-side:
 *  - only a SHA-256 hash is stored, never the code itself
 *  - codes expire after 10 minutes
 *  - 5 wrong attempts burns the code, so it cannot be brute-forced
 *    (a 6-digit code is only a million values — attempt limiting is what makes
 *    it safe, not its length)
 *  - a new code can be requested at most every 30 seconds
 *  - comparison is constant-time
 */

const TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 5;

export type CodePurpose = "verify_email" | "reset_password";

type CodeDoc = {
  hash: string;
  purpose: CodePurpose;
  createdAt: Timestamp;
  attempts: number;
};

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

const key = (email: string, purpose: CodePurpose) =>
  `${purpose}:${email.trim().toLowerCase()}`;

const codes = () => db.collection("authCodes");

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: "cooldown"; retryInSeconds: number };

export async function issueCode(
  email: string,
  purpose: CodePurpose,
): Promise<IssueResult> {
  const ref = codes().doc(key(email, purpose));
  const existing = await ref.get();

  if (existing.exists) {
    const createdAt = existing.get("createdAt") as Timestamp | undefined;
    const age = createdAt ? Date.now() - createdAt.toMillis() : Infinity;
    if (age < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: "cooldown",
        retryInSeconds: Math.ceil((RESEND_COOLDOWN_MS - age) / 1000),
      };
    }
  }

  // randomInt is CSPRNG-backed; Math.random is not, and this is a credential.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await ref.set({
    hash: hash(code),
    purpose,
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
  });

  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

export async function verifyCode(
  email: string,
  purpose: CodePurpose,
  candidate: string,
): Promise<VerifyResult> {
  const ref = codes().doc(key(email, purpose));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "invalid" };

  const doc = snap.data() as CodeDoc;

  if (doc.attempts >= MAX_ATTEMPTS) {
    await ref.delete();
    return { ok: false, reason: "too_many_attempts" };
  }

  const createdAt = doc.createdAt?.toMillis?.() ?? 0;
  if (Date.now() - createdAt > TTL_MS) {
    await ref.delete();
    return { ok: false, reason: "expired" };
  }

  const a = Buffer.from(hash(candidate.trim()), "hex");
  const b = Buffer.from(doc.hash, "hex");
  const matches = a.length === b.length && timingSafeEqual(a, b);

  if (!matches) {
    await ref.update({ attempts: FieldValue.increment(1) });
    return { ok: false, reason: "invalid" };
  }

  // Single use.
  await ref.delete();
  return { ok: true };
}
