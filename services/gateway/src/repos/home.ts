import { HomeSchema, type Home } from "@alltheway/contracts";

import { getOnboarding } from "./onboarding.js";
import { buildDigest } from "./digest.js";
import { getSession, listSessions } from "./sessions.js";
import { listRuns } from "./watchers.js";
import { listHomeDocuments } from "../routes/documents.js";

/**
 * Everything Today needs, in one round trip.
 *
 * The client used to wait for onboarding, then fire four more requests, one of
 * them itself two hops. Greeting and the capability cards do not need this;
 * the continue card, digest and overnight do.
 */
export async function buildHome(uid: string): Promise<Home> {
  const [onboarding, digest, sessions, runs, documents] = await Promise.all([
    getOnboarding(uid),
    buildDigest(uid),
    listSessions(uid),
    listRuns(uid),
    listHomeDocuments(uid),
  ]);

  const row = sessions.find((s) => s.done < s.total) ?? sessions[0];
  const plan = row ? await getSession(uid, row.id) : null;

  return HomeSchema.parse({ onboarding, plan, digest, runs, documents });
}
