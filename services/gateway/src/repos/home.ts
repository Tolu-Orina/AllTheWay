import { HomeSchema, type Home } from "@alltheway/contracts";

import { buildDay } from "../calendar-day.js";
import { getOnboarding } from "./onboarding.js";
import { buildDigest } from "./digest.js";
import { getSession, listSessions } from "./sessions.js";
import { listRuns } from "./watchers.js";
import { listHomeDocuments } from "../routes/documents.js";
import { listPeople, listPlaces, listProposed, listReminders, listRhythms, ensureLeaveReminders } from "./life.js";

/**
 * Everything Today needs, in one round trip.
 *
 * Greeting and the capture cards do not need this; the day, digest,
 * continue card and overnight do.
 */
export async function buildHome(uid: string): Promise<Home> {
  const [onboarding, digest, sessions, runs, documents, day, proposed, people, places, rhythms] =
    await Promise.all([
      getOnboarding(uid),
      buildDigest(uid),
      listSessions(uid),
      listRuns(uid),
      listHomeDocuments(uid),
      buildDay(uid),
      listProposed(uid),
      listPeople(uid),
      listPlaces(uid),
      listRhythms(uid),
    ]);

  const row = sessions.find((s) => s.done < s.total) ?? sessions[0];
  const plan = row ? await getSession(uid, row.id) : null;

  await ensureLeaveReminders(uid, day).catch((err) => {
    console.warn(`[home] leave reminders: ${(err as Error).message}`);
  });
  const reminders = await listReminders(uid, ["scheduled", "fired"]);

  return HomeSchema.parse({
    onboarding,
    plan,
    digest,
    runs,
    documents,
    day,
    reminders,
    proposed,
    people,
    places,
    rhythms,
  });
}
