import { db } from "./firestore.js";
import { env } from "./env.js";
import { connectorClient } from "./a2a.js";
import { getSession } from "./repos/sessions.js";

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

    const grant = await db.collection("connectorGrants").doc(`${opts.uid}:${connector}`).get();
    if (!grant.exists) {
      outcomes.push({
        ...base,
        did: "skipped",
        // Named, and actionable: the one thing that would make this work.
        detail: `${connector} is not connected. It can be connected from Profile.`,
      });
      continue;
    }

    try {
      const client = await connectorClient();
      const task = await Promise.race([
        client.sendMessage({
          tenant: opts.uid,
          message: {
            messageId: `act-${opts.sessionId}-${outcomes.length}-${Date.now().toString(36)}`,
            role: "ROLE_USER" as never,
            parts: [
              {
                data: {
                  data: {
                    connector,
                    tool,
                    arguments: step.arguments ?? {},
                    grant: grant.data() ?? {},
                    // The person saw this step and said yes to it. That is what
                    // this flag means, and it is the only reason it is set.
                    confirmed: true,
                  },
                },
              },
            ] as never,
          } as never,
          configuration: undefined,
          metadata: undefined,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("the connector did not answer in time")), ACT_TIMEOUT_MS),
        ),
      ]);

      const detail = textOf(task);
      // A refusal is not a failure. The floor declining an action is the system
      // working, and it reads to a person as a different thing from a crash.
      const refused = /refus|not permitted|ceiling|blocked|policy/i.test(detail);
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

/** The readable text of whatever the agent sent back. */
function textOf(task: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.text === "string" && rec.text.trim()) parts.push(rec.text.trim());
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(task);
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
