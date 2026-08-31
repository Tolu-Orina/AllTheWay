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

/** A list row, not a transcript. Long enough to name the job, not the speech. */
const TITLE_CAP = 40;

const LEAD_IN =
  /^(?:(?:hey|hi|hello|hiya|please|um+|uh+|er+|ah+|so|well|okay|ok|yeah|yep|yup|right)\b[,.!?]?\s*)+/i;

const REQUEST =
  /^(?:(?:can|could|would|will)\s+you(?:\s+please)?|please|(?:i(?:'d|\s+would)?\s+like\s+to)|i\s+want(?:ed)?\s+to|i\s+need(?:\s+you)?\s+to|can\s+we|could\s+we)\s+/i;

const THIN_TITLE =
  /^(hi|hey|hello|hiya|hey there|hello there|yeah|yes|ok|okay|yo|thanks|thank you|cheers)[.!?]*$/i;

const toIso = (value: unknown): string =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : new Date(0).toISOString();

function sentenceCase(value: string): string {
  const letter = value.match(/\p{L}/u);
  if (!letter || letter.index === undefined) return value;
  const i = letter.index;
  return value.slice(0, i) + letter[0].toLocaleUpperCase() + value.slice(i + 1);
}

export function isThinTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (UNLOCKED.has(t)) return true;
  return THIN_TITLE.test(t);
}

/**
 * A short label for the session list, from what they said.
 *
 * Not the utterance itself: a spoken first line is often a greeting, a
 * request wrapper, and two jobs. The list needs a name you can scan.
 */
export function clipTitle(utterance: string): string {
  let text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return "";

  for (let n = 0; n < 4; n++) {
    const next = text.replace(LEAD_IN, "").replace(REQUEST, "").trim();
    if (next === text) break;
    text = next;
  }
  if (!text) {
    text = utterance.replace(/\s+/g, " ").trim();
  }

  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  const primary = (sentence.split(/\s+(?:and also|and then)\s+/i)[0] ?? sentence).trim();
  const stripped = primary.replace(/[,:;]+$/u, "").replace(/[.!?]+$/u, "").trim();
  if (!stripped) return "";

  if (stripped.length <= TITLE_CAP) return sentenceCase(stripped);

  const cut = stripped.slice(0, TITLE_CAP);
  const at = cut.lastIndexOf(" ");
  const clipped = (at >= 12 ? cut.slice(0, at) : cut).trimEnd();
  return sentenceCase(clipped.replace(/[,:;]+$/u, ""));
}

/** Next stored title. Unlocked and greeting-only rows can still be named. */
export function nextTitle(current: string, utterance?: string): string {
  const currentTitle = current.trim();
  const fromUtterance = utterance ? clipTitle(utterance) : "";
  const candidate = fromUtterance && !isThinTitle(fromUtterance) ? fromUtterance : "";
  if (candidate && isThinTitle(currentTitle)) return candidate;
  return currentTitle || candidate || DEFAULT_TITLE;
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
    if (text) {
      lines.push(`${m.role}: ${text.length <= LINE_CAP ? text : `${text.slice(0, LINE_CAP).trimEnd()}…`}`);
    } else if (m.attachments?.length) {
      lines.push(`${m.role}: (attached ${m.attachments.map((a) => a.name).join(", ")})`);
    } else {
      continue;
    }
    if (m.attachments?.length && text) {
      lines.push(`attached: ${m.attachments.map((a) => a.name).join(", ")}`);
    }
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

export type SessionSurface = "work" | "companion" | "voice";

export function sessionSurface(id: string, data: { surface?: unknown } = {}): SessionSurface {
  if (id === "companion" || data.surface === "companion") return "companion";
  if (data.surface === "voice") return "voice";
  return "work";
}

export type TouchInput = {
  /** First user utterance. Names a new row as a short summary; ignored once locked. */
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
  const title =
    opts.title?.trim() ||
    (surface === "companion" ? COMPANION_TITLE : surface === "voice" ? VOICE_TITLE : DEFAULT_TITLE);
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
  const title = nextTitle(currentTitle, input.utterance);

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
    const next = [...existing];
    for (const entry of entries) {
      const last = next[next.length - 1];
      if (
        last &&
        last.role === entry.role &&
        last.text.trim() === entry.text.trim()
      ) {
        continue;
      }
      next.push(entry);
    }
    tx.set(
      ref,
      { thread: next.slice(-THREAD_CAP), updatedAt: FieldValue.serverTimestamp() },
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

export type PlanArgPatch = {
  connector: string;
  tool: string;
  arguments: Record<string, unknown>;
};

type ConfirmWrite = {
  label?: string;
  action?: string;
  connector?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

function isGmail(connector: string): boolean {
  return !connector || connector === "google_gmail" || connector === "gmail";
}

function sameWrite(step: PlanStep, action: ConfirmWrite): boolean {
  const connector = step.connector ?? "";
  const other = action.connector ?? "";
  const tool = action.tool ?? "";
  if (step.tool === tool && (!connector || !other || connector === other)) return true;
  if (step.tool === "send_email" && tool === "create_draft" && isGmail(connector) && isGmail(other)) {
    return true;
  }
  if (step.label === action.label && step.tool && tool) return true;
  return false;
}

/**
 * Replay the calls the confirm gate showed.
 *
 * Streamed steps are the model's first pass. The gate may rewrite send_email
 * to create_draft. Yes used to replay the streamed step and send.
 */
export function overlayConfirmOnPlan(steps: PlanStep[], actions: ConfirmWrite[]): PlanStep[] {
  const writes = actions.filter((a) => a.connector && a.tool);
  if (!writes.length) return steps;
  const taken = new Set<number>();
  return steps.map((step) => {
    const idx = writes.findIndex((action, i) => !taken.has(i) && sameWrite(step, action));
    if (idx < 0) return step;
    taken.add(idx);
    const action = writes[idx];
    return {
      ...step,
      connector: action.connector || step.connector,
      tool: action.tool || step.tool,
      action: action.action || step.action,
      arguments: { ...(step.arguments ?? {}), ...(action.arguments ?? {}) },
    };
  });
}

/**
 * Merge edited compose fields onto the stored plan.
 *
 * Connector and tool are identity, never an update. The browser cannot rename
 * create_draft to send_email by PATCHing arguments.
 */
export function mergePlanArguments(
  plan: PlanStep[],
  patches: PlanArgPatch[],
): { ok: true; plan: PlanStep[] } | { ok: false; reason: "mismatch" } {
  if (!patches.length) return { ok: true, plan };
  const next = plan.map((step) => ({
    ...step,
    arguments: { ...(step.arguments ?? {}) },
  }));
  for (const patch of patches) {
    const idx = next.findIndex(
      (step) =>
        step.tool === patch.tool &&
        (step.connector === patch.connector || !step.connector),
    );
    if (idx < 0) return { ok: false, reason: "mismatch" };
    next[idx] = {
      ...next[idx],
      arguments: { ...next[idx].arguments, ...patch.arguments },
    };
  }
  return { ok: true, plan: next };
}

export async function patchPlanArguments(
  uid: string,
  id: string,
  patches: PlanArgPatch[],
): Promise<"ok" | "missing" | "mismatch"> {
  const ref = sessions(uid).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "missing";
    const plan = asPlan(snap.get("plan"));
    // An empty plan has already been claimed. Writing args back would
    // resurrect a write after Yes had taken it.
    if (!plan.length) return "mismatch";
    const merged = mergePlanArguments(plan, patches);
    if (!merged.ok) return "mismatch";
    tx.set(
      ref,
      { ...planFields(merged.plan), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return "ok";
  });
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
  if (surface === "companion" || surface === "voice") {
    const snap = await sessions(uid).where("surface", "==", surface).limit(50).get();
    const docs: DocumentSnapshot[] = [...snap.docs];
    if (surface === "companion") {
      const legacy = await sessions(uid).doc("companion").get();
      if (legacy.exists && !docs.some((d) => d.id === "companion")) {
        docs.push(legacy);
      }
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
