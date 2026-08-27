import { FieldValue } from "firebase-admin/firestore";
import {
  SessionDetailSchema,
  SessionSchema,
  type PlanStep,
  type Session,
  type SessionDetail,
} from "@alltheway/contracts";

import { sessions } from "../firestore.js";

/**
 * A session parent document that list queries can see.
 *
 * Firestore does not return documents that only have subcollections. Voice used
 * to write `sessions/{id}/transcript/…` with no parent fields, so
 * `orderBy("updatedAt")` never showed the conversation. Every write here is a
 * merge of the fields `SessionDetailSchema` requires, so GET cannot 500 on parse
 * after a first turn.
 */

export const DEFAULT_TITLE = "New work";
export const VOICE_TITLE = "Voice";

/** Titles that the next utterance is still allowed to replace. */
const UNLOCKED = new Set(["", DEFAULT_TITLE, VOICE_TITLE]);

const toIso = (value: unknown): string =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : new Date(0).toISOString();

export function clipTitle(utterance: string): string {
  const oneLine = utterance.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length <= 80 ? oneLine : oneLine.slice(0, 80).trimEnd();
}

function asPlan(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((step): step is Record<string, unknown> => !!step && typeof step === "object")
    .filter((step) => typeof step.label === "string")
    .map((step) => ({
      label: step.label as string,
      done: step.done === true,
      action: typeof step.action === "string" ? step.action : "",
    }));
}

function planFields(plan: PlanStep[]) {
  return {
    plan,
    done: plan.filter((step) => step.done).length,
    // SessionSchema.total is `.positive()`. An empty plan is still a piece of
    // work, not a document that fails to parse.
    total: Math.max(plan.length, 1),
  };
}

export type TouchInput = {
  /** First user utterance. Titles a new row; ignored once the title is locked. */
  utterance?: string;
  plan?: PlanStep[];
  companionNote?: string;
  scope?: string;
};

/**
 * Materialise a parent document if one is not already there.
 *
 * Idempotent. A second call does not bump `updatedAt` or rewrite the title —
 * New allocates the row; talking is what makes it recent.
 */
export async function ensureSession(
  uid: string,
  id: string,
  opts: { title?: string } = {},
): Promise<void> {
  const ref = sessions(uid).doc(id);
  const snap = await ref.get();
  if (snap.exists) return;

  const title = opts.title?.trim() || DEFAULT_TITLE;
  await ref.set({
    title,
    updatedAt: FieldValue.serverTimestamp(),
    ...planFields([]),
    scope: "",
    companionNote: "",
    correction: null,
  });
}

/**
 * Record that this work was touched.
 *
 * Creates the parent if needed (talking is enough; New is not a prerequisite).
 * Later turns update `updatedAt` and, when a plan arrived, the plan. They do
 * not overwrite a title that is already real.
 */
export async function touchSession(uid: string, id: string, input: TouchInput = {}): Promise<void> {
  const ref = sessions(uid).doc(id);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() ?? {}) : {};

  const currentTitle = typeof existing.title === "string" ? existing.title.trim() : "";
  const fromUtterance = input.utterance ? clipTitle(input.utterance) : "";
  const title =
    UNLOCKED.has(currentTitle) && fromUtterance
      ? fromUtterance
      : currentTitle || fromUtterance || DEFAULT_TITLE;

  const plan = input.plan !== undefined ? asPlan(input.plan) : asPlan(existing.plan);
  const writePlan = input.plan !== undefined ? planFields(plan) : snap.exists ? {} : planFields([]);

  const companionNote =
    input.companionNote !== undefined
      ? input.companionNote
      : typeof existing.companionNote === "string"
        ? existing.companionNote
        : "";

  const scope =
    input.scope !== undefined
      ? input.scope
      : typeof existing.scope === "string"
        ? existing.scope
        : "";

  await ref.set(
    {
      title,
      updatedAt: FieldValue.serverTimestamp(),
      ...writePlan,
      scope,
      companionNote,
      correction: existing.correction ?? null,
    },
    { merge: true },
  );
}

/** Stub for Cut 1b: a confirmed plan is stored on the session, then cleared. */
export async function clearPendingConfirm(uid: string, id: string): Promise<void> {
  await sessions(uid).doc(id).set({ pendingConfirm: FieldValue.delete() }, { merge: true });
}

export async function listSessions(uid: string): Promise<Session[]> {
  const snap = await sessions(uid).orderBy("updatedAt", "desc").limit(50).get();
  // Parsed on the way out: a malformed document fails here, in one place,
  // rather than as a mystery undefined in the UI.
  return snap.docs.map((d) =>
    SessionSchema.parse({ id: d.id, ...d.data(), updatedAt: toIso(d.get("updatedAt")) }),
  );
}

export async function getSession(uid: string, id: string): Promise<SessionDetail | null> {
  const doc = await sessions(uid).doc(id).get();
  if (!doc.exists) return null;
  return SessionDetailSchema.parse({
    id: doc.id,
    ...doc.data(),
    updatedAt: toIso(doc.get("updatedAt")),
    plan: asPlan(doc.get("plan")),
    scope: doc.get("scope") ?? "",
    companionNote: doc.get("companionNote") ?? "",
    correction: doc.get("correction") ?? null,
    done: doc.get("done") ?? 0,
    total: Math.max(Number(doc.get("total")) || 0, 1),
  });
}
