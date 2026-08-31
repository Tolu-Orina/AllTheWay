import { HomeSchema, type Home } from "@alltheway/contracts";

import { buildDayFromParts, calendarGrantStatus } from "../calendar-day.js";
import { getOnboarding } from "./onboarding.js";
import { getActiveHat } from "./hat.js";
import { buildDigest } from "./digest.js";
import { getSession, listSessions } from "./sessions.js";
import { listRuns } from "./watchers.js";
import { listHomeDocuments } from "../routes/documents.js";
import { listPeople, listPlaces, listProposed, listReminders, listRhythms, ensureLeaveReminders } from "./life.js";

/**
 * Everything Today needs, in one round trip.
 *
 * The calendar day is intentionally excluded — it requires an external network
 * call to the connector-gateway which can take up to 20 seconds (cold start +
 * Google Calendar API). Everything else here is local Firestore reads and
 * responds in under a second. The browser fetches the calendar day separately
 * via GET /home/day so the page shell renders immediately.
 *
 * Day items from local rhythms are still included so the timeline is not
 * completely empty while the calendar loads.
 */
export async function buildHome(uid: string): Promise<Home> {
  const now = new Date();
  const [onboarding, digest, sessions, runs, documents, reminders, proposed, people, places, rhythms, hat, calendar] =
    await Promise.all([
      getOnboarding(uid),
      buildDigest(uid),
      listSessions(uid),
      listRuns(uid),
      listHomeDocuments(uid),
      listReminders(uid, ["scheduled", "fired"]),
      listProposed(uid),
      listPeople(uid),
      listPlaces(uid),
      listRhythms(uid),
      getActiveHat(uid),
      calendarGrantStatus(uid),
    ]);

  const row = sessions.find((s) => s.done < s.total) ?? sessions[0];
  const plan = row ? await getSession(uid, row.id) : null;

  // Rhythm-only day plus grant status. Calendar *events* come via /home/day
  // so a cold connector-gateway cannot hold the page. Missing is instant.
  const day = buildDayFromParts(places, rhythms, people, { status: calendar, events: [] }, now);

  // Fire-and-forget: creates leave reminders for upcoming rhythm items.
  // Does not block the response — reminders appear on next reload.
  ensureLeaveReminders(uid, day).catch((err) => {
    console.warn(`[home] leave reminders: ${(err as Error).message}`);
  });

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
    hat,
  });
}
