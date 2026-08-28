import { db } from "./firestore.js";
import { env } from "./env.js";
import { connectorClient, connectorInvokeMessage } from "./a2a.js";
import { getSession } from "./repos/sessions.js";
import { MEDIA_TOOLS, persistGeneratedMedia } from "./media-persist.js";
import {
  connectorIsConnected,
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
 * The ledger row is written first and its id is passed down, so a second Yes
 * for the same decision finds the work already done rather than sending twice.
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

  if (!env.connectorGatewayUrl) {
    return actionable.map((s) => ({
      label: s.label ?? "",
      connector: s.connector ?? "",
      tool: s.tool ?? "",
      did: "skipped",
      detail: "Connections are not available in this environment.",
    }));
  }

  const outcomes: ActOutcome[] = [];

  // Serially, not in parallel. These are irreversible-adjacent, and a failure
  // half way through a parallel fan-out leaves nobody able to say what ran.
  for (const step of actionable) {
    const connector = step.connector as string;
    const tool = step.tool as string;
    const base = { label: step.label ?? "", connector, tool };

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
    }

    try {
      const timeoutMs = tool === "generate_image" ? IMAGE_TIMEOUT_MS : ACT_TIMEOUT_MS;
      const task = await runConnectorTool({
        uid: opts.uid,
        sessionId: opts.sessionId,
        connector,
        tool,
        arguments: step.arguments ?? {},
        confirmed: true,
        timeoutMs,
      });

      const refused = isRefusal(task);
      let detail = readableDetail(task);
      if (!refused && MEDIA_TOOLS.has(tool)) {
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
  const plan = (session?.plan ?? []) as ActableStep[];
  return Array.isArray(plan) ? plan : [];
}
