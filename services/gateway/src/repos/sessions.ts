import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
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
import type { ActiveHat } from "../hat.js";

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
export const COMPANION_TITLE = "New chat";
export const VOICE_TITLE = "Voice";

/** Titles that the next utterance is still allowed to replace. */
const UNLOCKED = new Set(["", DEFAULT_TITLE, COMPANION_TITLE, VOICE_TITLE]);

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

export type SessionSurface = "work" | "companion";

export function sessionSurface(id: string, data: { surface?: unknown } = {}): SessionSurface {
  if (id === "companion" || data.surface === "companion") return "companion";
  return "work";
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
  opts: { title?: string; surface?: SessionSurface } = {},
): Promise<void> {
  const ref = sessions(uid).doc(id);
  const snap = await ref.get();
  if (snap.exists) return;

  const surface = opts.surface ?? sessionSurface(id);
  const title = opts.title?.trim() || (surface === "companion" ? COMPANION_TITLE : DEFAULT_TITLE);
  await ref.set({
    title,
    updatedAt: FieldValue.serverTimestamp(),
    ...planFields([]),
    scope: "",
    companionNote: "",
    correction: null,
    surface,
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

  const surface = sessionSurface(id, existing);

  await ref.set(
    {
      title,
      updatedAt: FieldValue.serverTimestamp(),
      ...writePlan,
      scope,
      companionNote,
      correction: existing.correction ?? null,
      surface,
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

/**
 * Whether a decision is a learning signal, before anything is written.
 *
 * `missing_now` is the HTTP 400 "a correction needs what it should have been."
 * `noop` is the same words twice: agreement is not a correction.
 */
export function correctionFields(
  summary: string,
  now: string | undefined,
): { ok: true; was: string; now: string } | { ok: false; reason: "missing_now" | "noop" } {
  const was = summary.trim();
  const next = now?.trim() ?? "";
  if (!next) return { ok: false, reason: "missing_now" };
  if (!was || was === next) return { ok: false, reason: "noop" };
  return { ok: true, was, now: next };
}

/**
 * The learning signal for this session.
 *
 * Last write wins: one session produces one preference document
 * (`session-{id}`), so a second correction in the same thread replaces the
 * first rather than queuing two facts the synthesizer cannot both own.
 */
export async function setCorrection(
  uid: string,
  id: string,
  correction: { was: string; now: string; hat?: ActiveHat },
): Promise<"ok" | "missing" | "noop"> {
  const parsed = correctionFields(correction.was, correction.now);
  if (!parsed.ok) return "noop";
  const ref = sessions(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return "missing";
  await ref.set(
    {
      correction: {
        was: parsed.was,
        now: parsed.now,
        hat: correction.hat ?? null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return "ok";
}

/** Stub for Cut 1b: a confirmed plan is stored on the session, then cleared. */
export async function clearPendingConfirm(uid: string, id: string): Promise<void> {
  await sessions(uid).doc(id).set({ pendingConfirm: FieldValue.delete() }, { merge: true });
}

export async function listSessions(
  uid: string,
  surface: SessionSurface = "work",
): Promise<Session[]> {
  if (surface === "companion") {
    const snap = await sessions(uid).where("surface", "==", "companion").limit(50).get();
    const docs: DocumentSnapshot[] = [...snap.docs];
    const legacy = await sessions(uid).doc("companion").get();
    if (legacy.exists && !docs.some((d) => d.id === "companion")) {
      docs.push(legacy);
    }
    return docs
      .map(asListedSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const snap = await sessions(uid).orderBy("updatedAt", "desc").limit(50).get();
  return snap.docs
    .filter((d) => sessionSurface(d.id, d.data() ?? {}) === "work")
    .map(asListedSession);
}

function asListedSession(d: DocumentSnapshot): Session {
  return SessionSchema.parse({
    id: d.id,
    ...d.data(),
    updatedAt: toIso(d.get("updatedAt")),
    surface: sessionSurface(d.id, d.data() ?? {}),
  });
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
    surface: sessionSurface(doc.id, doc.data() ?? {}),
  });
}
