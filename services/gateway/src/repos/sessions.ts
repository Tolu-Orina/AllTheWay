import { FieldValue } from "firebase-admin/firestore";
import {
  PlanStepSchema,
  SessionDetailSchema,
  SessionSchema,
  ThreadMessageSchema,
  type PlanStep,
  type Session,
  type SessionDetail,
  type ThreadMessage,
} from "@alltheway/contracts";

import { db, sessions } from "../firestore.js";

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
  const out: PlanStep[] = [];
  for (const step of value) {
    const parsed = PlanStepSchema.safeParse(step);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function asThread(value: unknown): ThreadMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ThreadMessage[] = [];
  for (const item of value) {
    const parsed = ThreadMessageSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Last N bubbles. A session document must stay well under Firestore's 1 MB. */
const THREAD_CAP = 80;

/** How much of the thread the planner sees. Enough to answer a follow-up, not an archive. */
const PLANNER_THREAD = 12;
const LINE_CAP = 400;

/**
 * The recent conversation, as lines the orchestrator can put in system context.
 *
 * Each turn used to send only the latest bubble. "Anime character illustration"
 * then looked like a new request with no subject, so the clarify gate asked
 * again — and again — and the image never started.
 */
export function conversationContext(thread: ThreadMessage[]): string[] {
  const lines: string[] = [];
  for (const m of thread.slice(-PLANNER_THREAD)) {
    const text = m.text.trim();
    if (!text) continue;
    lines.push(`${m.role}: ${text.length <= LINE_CAP ? text : `${text.slice(0, LINE_CAP).trimEnd()}…`}`);
    if (m.options?.length) {
      lines.push(`options: ${m.options.join(" | ")}`);
    }
  }
  return lines;
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

/**
 * Append bubbles to the session's conversation.
 *
 * Transactional so two overlapping turns cannot drop a message. Cap, don't
 * grow forever: this is the recent thread, not an archive.
 */
export async function appendThread(
  uid: string,
  id: string,
  entries: ThreadMessage[],
): Promise<void> {
  if (!entries.length) return;
  const ref = sessions(uid).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = asThread(snap.exists ? snap.get("thread") : []);
    const next = [...existing, ...entries].slice(-THREAD_CAP);
    tx.set(
      ref,
      { thread: next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });
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
    thread: asThread(doc.get("thread")),
    done: doc.get("done") ?? 0,
    total: Math.max(Number(doc.get("total")) || 0, 1),
  });
}
