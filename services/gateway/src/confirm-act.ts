import type { ActOutcome } from "@alltheway/contracts";

import {
  actOnConfirmed,
  claimStoredPlan,
  clearStoredPlan,
  rememberActOutcomes,
} from "./act.js";
import { record } from "./repos/ledger.js";

/**
 * The one place a yes becomes effects.
 *
 * Voice used to wait for a spoken yes and then call `plan_turn` with
 * "yeah go ahead", which the planner treated as a new empty request. The
 * overlay button posts here; `they_said_yes` and a `plan_turn` that *is*
 * a yes now do too. Claiming the stored plan first is what stops two of
 * those paths from creating the same meeting twice.
 */
export async function carryOutConfirmedPlan(opts: {
  uid: string;
  sessionId: string;
  summary: string;
  modality: "voice" | "text";
  actions?: { label: string; action: string; reason: string }[];
}): Promise<{ id: string; did: ActOutcome[]; already: boolean }> {
  const claimed = await claimStoredPlan(opts.uid, opts.sessionId);
  const id = await record(opts.uid, {
    sessionId: opts.sessionId,
    kind: "confirmed",
    summary: opts.summary.trim() || "Should I go ahead?",
    actions: opts.actions ?? [],
    modality: opts.modality,
  });

  if (claimed.kind === "replay") {
    return { id, did: claimed.did, already: true };
  }
  if (claimed.kind === "empty") {
    return { id, did: [], already: false };
  }

  const did = await actOnConfirmed({
    uid: opts.uid,
    sessionId: opts.sessionId,
    steps: claimed.steps,
  });
  await rememberActOutcomes(opts.uid, opts.sessionId, did);
  return { id, did, already: false };
}

export async function declinePendingPlan(opts: {
  uid: string;
  sessionId: string;
  summary: string;
  modality: "voice" | "text";
  actions?: { label: string; action: string; reason: string }[];
}): Promise<{ id: string; did: ActOutcome[] }> {
  await clearStoredPlan(opts.uid, opts.sessionId);
  const id = await record(opts.uid, {
    sessionId: opts.sessionId,
    kind: "declined",
    summary: opts.summary.trim() || "Should I go ahead?",
    actions: opts.actions ?? [],
    modality: opts.modality,
  });
  return { id, did: [] };
}

export function speakActOutcomes(did: ActOutcome[]): string {
  if (!did.length) {
    return "There was nothing waiting on a yes. If they still want something done, call plan_turn with the full request, not just their yes.";
  }
  return did
    .map((row) => {
      const name = row.label || `${row.connector}.${row.tool}`;
      if (row.did === "done") return `${name}: done. ${row.detail}`.trim();
      return `${name}: ${row.did}. ${row.detail}`.trim();
    })
    .join(" ");
}
