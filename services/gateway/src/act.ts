import { FieldValue } from "firebase-admin/firestore";

import { db, sessions } from "./firestore.js";
import { env } from "./env.js";
import { connectorClient, connectorInvokeMessage } from "./a2a.js";
import { getSession } from "./repos/sessions.js";
import { MEDIA_TOOLS, persistGeneratedMedia, videoStartFromConnectorTask } from "./media-persist.js";
import { actWorkFiles, isWorkFilesStep } from "./office-persist.js";
import { createStudioJob } from "./repos/studio-jobs.js";
import {
  connectorIsConnected,
  createDraftSkipReason,
  enforcementGrant,
  googleGrantId,
  isGoogleConnector,
} from "./google-scopes.js";

/**
 * Doing what the person said yes to.
 *
 * ## Why the gateway is the actor
 *
 * The orchestrator plans and is told never to act — putting effects on the
 * planning path would mean a model timeout could leave a half-sent email inside
 * a turn stream. The browser cannot call the Agent Gateway either: it is a
 * public surface, and the autonomy floor would be one fetch away from being
 * skipped. That leaves this service, which already holds the grants and already
 * knows who the user is.
 *
 * ## It replays, it does not re-derive
 *
 * The call comes from the plan the person was shown. Nothing here re-reads the
 * request or asks a model what they probably meant: the whole point of a
 * confirmation is that what happens is what was on screen. A step whose
 * `connector` and `tool` are empty changes nothing and is skipped.
 *
 * ## Confirmed once
 *
 * The ledger row is written first. A second Yes for the same stored plan
 * finds it already claimed (`claimStoredPlan`) rather than creating twice —
 * voice can confirm from the overlay *and* from `they_said_yes` on the same
 * utterance.
 */

/** One replayed step, and what became of it. */
export type ActOutcome = {
  label: string;
  connector: string;
  tool: string;
  /** "done", "refused", "skipped", or "failed". */
  did: string;
  detail: string;
};

const ACT_TIMEOUT_MS = 20_000;
/** Image generation is a Vertex round-trip, not a calendar list. */
const IMAGE_TIMEOUT_MS = 90_000;

export type ActableStep = {
  label?: string;
  connector?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export type ClaimedPlan =
  | { kind: "run"; steps: ActableStep[] }
  | { kind: "replay"; did: ActOutcome[] }
  | { kind: "empty" };

const PLACEHOLDER_EVENT_IDS = new Set([
  "",
  "new",
  "pending",
  "none",
  "null",
  "event_id",
  "the new event",
]);

export function isPlaceholderEventId(id: string): boolean {
  const t = id.trim().toLowerCase();
  return PLACEHOLDER_EVENT_IDS.has(t) || t.startsWith("<") || t.includes("{{");
}

/** Flatten attendees so MCP tools that take a string still get the list. */
export function prepareCallArgs(
  step: ActableStep,
  createdEventId: string,
): Record<string, unknown> {
  const args = { ...(step.arguments ?? {}) };
  if (Array.isArray(args.attendees)) {
    args.attendees = args.attendees
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join(",");
  }
  if (step.tool === "send_invite") {
    return bindInviteEventId(args, createdEventId);
  }
  return args;
}

export function bindInviteEventId(
  args: Record<string, unknown>,
  createdEventId: string,
): Record<string, unknown> {
  const eid = typeof args.event_id === "string" ? args.event_id : "";
  if (createdEventId && isPlaceholderEventId(eid)) {
    return { ...args, event_id: createdEventId };
  }
  return args;
}

/**
 * The id Google (or the in-memory calendar) assigned, so the next step can
 * invite people to the event that was just created rather than to "".
 */
export function eventIdFromConnectorTask(task: unknown): string {
  let found = "";
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12 || found) return;
    const rec = node as Record<string, unknown>;
    const created = rec.created;
    if (created && typeof created === "object") {
      const id = (created as { id?: unknown }).id;
      if (typeof id === "string" && id) {
        found = id;
        return;
      }
    }
    const titled = typeof rec.title === "string" || typeof rec.summary === "string";
    if (typeof rec.id === "string" && rec.id && titled) {
      found = rec.id;
      return;
    }
    if (typeof rec.eventId === "string" && rec.eventId) {
      found = rec.eventId;
      return;
    }
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) value.forEach((item) => walk(item, depth + 1));
      else if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  walk(task, 0);
  return found;
}

function stepsFromSnap(snap: { exists: boolean; get: (field: string) => unknown }): ActableStep[] {
  const plan = snap.get("plan");
  if (Array.isArray(plan)) {
    const fromPlan = plan.filter(
      (s): s is ActableStep =>
        !!s && typeof s === "object" && !!(s as ActableStep).connector && !!(s as ActableStep).tool,
    );
    if (fromPlan.length) return fromPlan;
  }
  const thread = snap.get("thread");
  if (!Array.isArray(thread)) return [];
  for (let i = thread.length - 1; i >= 0; i--) {
    const actions = (thread[i] as { actions?: ActableStep[] } | undefined)?.actions ?? [];
    const calls = actions.filter((a) => a.connector && a.tool);
    if (calls.length) return calls;
  }
  return [];
}

/**
 * Take the stored plan once. A second Yes in the same moment (spoken tool +
 * overlay button) must not create a second meeting.
 */
export async function claimStoredPlan(uid: string, sessionId: string): Promise<ClaimedPlan> {
  const ref = sessions(uid).doc(sessionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "empty" as const };
    const last = snap.get("lastActOutcomes");
    const replayed = Array.isArray(last) ? (last as ActOutcome[]) : [];
    const steps = stepsFromSnap(snap);
    if (!steps.length) {
      return replayed.length ? { kind: "replay" as const, did: replayed } : { kind: "empty" as const };
    }
    tx.set(ref, { plan: [], lastActClaimedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { kind: "run" as const, steps };
  });
}

export async function rememberActOutcomes(
  uid: string,
  sessionId: string,
  did: ActOutcome[],
): Promise<void> {
  await sessions(uid).doc(sessionId).set({ lastActOutcomes: did }, { merge: true });
}

export async function clearStoredPlan(uid: string, sessionId: string): Promise<void> {
  await sessions(uid).doc(sessionId).set({ plan: [] }, { merge: true });
}

/**
 * Run the steps of a confirmed plan that name a call.
 *
 * Never throws: a decision has already been recorded by the time this runs, and
 * losing the record of what the user agreed to because a connector was slow
 * would be worse than reporting a step that did not complete.
 */
export async function actOnConfirmed(opts: {
  uid: string;
  sessionId: string;
  steps: ActableStep[];
}): Promise<ActOutcome[]> {
  const actionable = opts.steps.filter((s) => s.connector && s.tool);
  if (actionable.length === 0) return [];

  const outcomes: ActOutcome[] = [];
  let createdEventId = "";

  // Serially, not in parallel. These are irreversible-adjacent, and a failure
  // half way through a parallel fan-out leaves nobody able to say what ran.
  for (const step of actionable) {
    const connector = step.connector as string;
    const tool = step.tool as string;
    const base = { label: step.label ?? "", connector, tool };

    // First-party Office files. No connector, no OAuth — generate bytes here.
    if (isWorkFilesStep(step)) {
      outcomes.push(await actWorkFiles({ uid: opts.uid, sessionId: opts.sessionId, step }));
      continue;
    }

    if (!env.connectorGatewayUrl) {
      outcomes.push({
        ...base,
        did: "skipped",
        detail: "Connections are not available in this environment.",
      });
      continue;
    }

    if (isGoogleConnector(connector)) {
      const grant = await db.collection("connectorGrants").doc(googleGrantId(opts.uid)).get();
      const scopes: string[] = grant.exists ? (grant.get("scopes") ?? []) : [];
      if (!grant.exists || !connectorIsConnected(connector, scopes)) {
        outcomes.push({
          ...base,
          did: "skipped",
          detail: `${connector} is not connected. It can be connected from Profile.`,
        });
        continue;
      }
      if (connector === "google_gmail" && tool === "create_draft") {
        const blocked = createDraftSkipReason(scopes);
        if (blocked) {
          outcomes.push({ ...base, did: "skipped", detail: blocked });
          continue;
        }
      }
    }

    try {
      const timeoutMs =
        tool === "generate_image" || tool === "draft_video" ? IMAGE_TIMEOUT_MS : ACT_TIMEOUT_MS;
      const arguments_ = prepareCallArgs(step, createdEventId);
      const task = await runConnectorTool({
        uid: opts.uid,
        sessionId: opts.sessionId,
        connector,
        tool,
        arguments: arguments_,
        confirmed: true,
        timeoutMs,
      });
      if (tool === "create_event" && !isRefusal(task)) {
        createdEventId = eventIdFromConnectorTask(task) || createdEventId;
      }

      const refused = isRefusal(task);
      let detail = readableDetail(task);
      if (!refused && MEDIA_TOOLS.has(tool)) {
        if (tool === "draft_video") {
          const started = videoStartFromConnectorTask(task);
          if (started.operation) {
            await createStudioJob({
              uid: opts.uid,
              operation: started.operation,
              model: started.model ?? "",
              prompt: typeof step.arguments?.prompt === "string" ? step.arguments.prompt : "",
              seconds: typeof step.arguments?.seconds === "number" ? step.arguments.seconds : 6,
            });
            detail = "Drafting a clip. Open Studio — it can take a few minutes.";
          } else if (started.error) {
            detail = started.error;
          }
        } else if (tool !== "poll_draft_video") {
          const saved = await persistGeneratedMedia({
            uid: opts.uid,
            sessionId: opts.sessionId,
            tool,
            prompt: typeof step.arguments?.prompt === "string" ? step.arguments.prompt : "",
            task,
          });
          if (saved && "artifact" in saved) {
            detail = `Saved as a ${saved.kind}. Open it in Studio or Canvas.`;
          } else if (saved && "error" in saved) {
            detail = saved.error;
          }
        }
      }
      outcomes.push({ ...base, did: refused ? "refused" : "done", detail });
    } catch (err) {
      console.warn(`[act] ${connector}.${tool} failed: ${(err as Error).message}`);
      outcomes.push({
        ...base,
        did: "failed",
        detail: "That did not go through. Nothing was changed by this step.",
      });
    }
  }

  return outcomes;
}

export type ConnectorCall = {
  uid: string;
  sessionId: string;
  connector: string;
  tool: string;
  arguments: Record<string, unknown>;
  confirmed?: boolean;
  costAcknowledged?: boolean;
  timeoutMs?: number;
};

/**
 * One call through the Agent Gateway, with confirmation already decided.
 *
 * Studio Generate is the same consent as Yes on a plan: the person typed the
 * prompt and pressed the button. The floor still sees `confirmed: true`.
 */
export async function runConnectorTool(call: ConnectorCall): Promise<unknown> {
  const client = await connectorClient();
  const timeoutMs = call.timeoutMs ?? ACT_TIMEOUT_MS;
  return Promise.race([
    client.sendMessage({
      tenant: call.uid,
      message: connectorInvokeMessage(`act-${call.sessionId}-${Date.now().toString(36)}`, {
        connector: call.connector,
        tool: call.tool,
        arguments: call.arguments,
        grant: enforcementGrant(call.connector, call.tool),
        confirmed: call.confirmed ?? true,
        costAcknowledged: call.costAcknowledged ?? false,
      }),
      configuration: undefined,
      metadata: undefined,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("the connector did not answer in time")), timeoutMs),
    ),
  ]);
}

function isRefusal(task: unknown): boolean {
  return /refus|not permitted|ceiling|blocked|policy|quota|allowance/i.test(readableDetail(task));
}

/** Short prose from a task. Skips base64 so a still cannot drown the note. */
export function readableDetail(task: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.reason === "string" && rec.reason.trim()) parts.push(rec.reason.trim());
    if (typeof rec.error === "string" && rec.error.trim()) parts.push(rec.error.trim());
    if (typeof rec.text === "string" && rec.text.trim() && rec.text.length < 800) {
      parts.push(rec.text.trim());
    }
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) value.forEach((item) => walk(item, depth + 1));
      else if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  walk(task, 0);
  return parts.join(" ").slice(0, 2000);
}

/**
 * The steps stored for a session, as the person last saw them.
 *
 * Read from the stored plan rather than taken from the request body: the
 * browser must not be able to name an action nobody was shown.
 */
export async function storedSteps(uid: string, sessionId: string): Promise<ActableStep[]> {
  const session = await getSession(uid, sessionId);
  if (!session) return [];
  const fromPlan = (session.plan ?? []).filter((s) => s.connector && s.tool);
  if (fromPlan.length) return fromPlan as ActableStep[];
  // Steps are streamed as they grow; the confirm payload is the gate's last
  // word on the call. A create_task with no connector is a ledger row and
  // nothing saved — so Yes must replay what was actually shown to confirm.
  for (let i = session.thread.length - 1; i >= 0; i--) {
    const actions = session.thread[i]?.actions ?? [];
    const calls = actions.filter((a) => a.connector && a.tool);
    if (calls.length) return calls as ActableStep[];
  }
  return [];
}
