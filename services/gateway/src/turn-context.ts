import type { ThreadMessage } from "@alltheway/contracts";

import { connectedLookups } from "./lookups.js";
import type { TurnInput } from "./orchestrator.js";
import { listConcepts } from "./repos/concepts.js";
import { getActiveHat } from "./repos/hat.js";
import { listPreferences } from "./repos/preferences.js";
import { retrieve } from "./repos/retrieval.js";
import { conversationContext, getSession } from "./repos/sessions.js";

/**
 * The turn payload, given the stores. Fetching is `loadTurnContext`;
 * this is the mapping, so a test can prove voice and text would send the
 * same fields without opening Firestore or a Live socket.
 */
export function assembleTurnContext(args: {
  uid: string;
  sessionId: string;
  message: string;
  prefs: { now: string }[];
  passages: NonNullable<TurnInput["passages"]>;
  lookups: string[];
  thread: ThreadMessage[];
  struggles?: NonNullable<TurnInput["struggles"]>;
}): TurnInput {
  return {
    sessionId: args.sessionId,
    userId: args.uid,
    message: args.message,
    knownPreferences: args.prefs.map((p) => p.now),
    passages: args.passages,
    lookups: args.lookups,
    thread: conversationContext(args.thread),
    struggles: args.struggles ?? [],
  };
}

/**
 * Everything a turn needs that the orchestrator must not fetch for itself.
 *
 * Text, voice `plan_turn`, and any later surface that plans must go through
 * here. A spoken "what's in the contract" that plans must not be dumber than
 * the typed one, and two copies of this fetch is how they would drift.
 */
export async function loadTurnContext(
  uid: string,
  sessionId: string,
  message: string,
): Promise<TurnInput> {
  const hat = await getActiveHat(uid);
  const [prefs, passages, lookups, session, struggles] = await Promise.all([
    listPreferences(uid, { hat, forTurn: true }),
    retrieve(uid, message, { hat }),
    connectedLookups(uid, message),
    getSession(uid, sessionId),
    listConcepts(uid),
  ]);
  return assembleTurnContext({
    uid,
    sessionId,
    message,
    prefs,
    passages,
    lookups,
    thread: session?.thread ?? [],
    struggles: struggles.map((c) => ({
      label: c.label,
      documentId: c.documentId,
      reasked: c.reasked,
      confidence: c.confidence,
    })),
  });
}
