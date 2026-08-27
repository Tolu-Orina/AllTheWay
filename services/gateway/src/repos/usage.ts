import { FieldValue } from "firebase-admin/firestore";

import { db } from "../firestore.js";

/**
 * What a user is on, and what they have spent this month.
 *
 * ## This table is a display copy, not the authority
 *
 * `libs/metering` decides entitlement, in the connector gateway, beside the
 * autonomy floor. These numbers exist so the browser can show someone where
 * they stand without the browser-facing service being given an IAM path into
 * the enforcement service to read a price list.
 *
 * The split is safe in the direction it can fail: a stale copy here shows the
 * wrong number, and nothing here decides whether anything is permitted. It is
 * the same trade already made for the OAuth consent scopes, for the same
 * reason.
 *
 * ## Voice minutes are recorded here because only here knows
 *
 * The relay holds the WebSocket, so the gateway is the only process that can
 * observe how long a voice session actually lasted. Recording it anywhere else
 * would mean trusting a client to report its own consumption.
 */

export type Meter =
  | "voice_minutes"
  | "watcher_runs"
  | "connector_calls"
  | "images"
  | "draft_video_seconds"
  | "final_video_seconds"
  | "meeting_insights";
export type Tier = "free" | "plus" | "team" | "max";

type Limits = Record<Meter, number | null>;

/**
 * Mirrors libs/metering, and `scripts/check-plan-table.py` proves it still
 * does. The comment that used to stand here said "changed together, or the
 * UI lies" — and then Phase C added a tier and three meters to the Python
 * side only, so the UI lied: a Max subscriber read as Free.
 */
const PLANS: Record<Tier, { label: string; pricePence: number; limits: Limits }> = {
  free: {
    label: "Free",
    pricePence: 0,
    limits: {
      voice_minutes: 30,
      watcher_runs: 50,
      connector_calls: 200,
      meeting_insights: 0,
      images: 20,
      draft_video_seconds: 0,
      final_video_seconds: 0,
    },
  },
  plus: {
    label: "Plus",
    pricePence: 1800,
    limits: {
      voice_minutes: 600,
      watcher_runs: 1000,
      connector_calls: 5000,
      meeting_insights: 0,
      images: 500,
      draft_video_seconds: 20,
      final_video_seconds: 0,
    },
  },
  team: {
    label: "Team",
    pricePence: 3200,
    limits: {
      voice_minutes: null,
      watcher_runs: null,
      connector_calls: null,
      meeting_insights: 300,
      images: 2000,
      draft_video_seconds: 60,
      final_video_seconds: 10,
    },
  },
  max: {
    label: "Max",
    pricePence: 6000,
    limits: {
      voice_minutes: null,
      watcher_runs: null,
      connector_calls: null,
      meeting_insights: null,
      images: null,
      draft_video_seconds: 300,
      final_video_seconds: 20,
    },
  },
};

const METERS: Meter[] = [
  "voice_minutes",
  "watcher_runs",
  "connector_calls",
  "meeting_insights",
  "images",
  "draft_video_seconds",
  "final_video_seconds",
];

/**
 * UTC, so a counter cannot be reset by travelling and two services never
 * disagree about which month it is.
 */
export function period(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

function tierOf(raw: unknown): Tier {
  // An unrecognised tier resolves to free. A corrupted subscription record
  // must never become an upgrade.
  return raw === "plus" || raw === "team" || raw === "max" ? raw : "free";
}

export async function readUsage(uid: string) {
  const [planDoc, usageDoc] = await Promise.all([
    db.collection("subscriptions").doc(uid).get(),
    db.collection("usage").doc(`${uid}::${period()}`).get(),
  ]);

  const tier = tierOf(planDoc.exists ? planDoc.get("tier") : undefined);
  const plan = PLANS[tier];

  return {
    tier,
    label: plan.label,
    pricePence: plan.pricePence,
    period: period(),
    meters: METERS.map((meter) => {
      const used = usageDoc.exists ? Number(usageDoc.get(meter) ?? 0) : 0;
      const limit = plan.limits[meter];
      return {
        meter,
        used: Math.max(used, 0),
        limit,
        remaining: limit === null ? null : Math.max(limit - used, 0),
        // Crossed before the user is refused, so the warning is still
        // something they can act on.
        nearLimit: limit !== null && limit > 0 && used >= limit * 0.8,
      };
    }),
  };
}

/**
 * Add to a meter. Called after the thing actually happened, never before.
 *
 * `Increment` rather than read-modify-write: two voice sessions ending at the
 * same moment must not lose one of the counts.
 */
export async function recordUsage(uid: string, meter: Meter, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    await db
      .collection("usage")
      .doc(`${uid}::${period()}`)
      .set({ [meter]: FieldValue.increment(amount) }, { merge: true });
  } catch (err) {
    // A lost count must not fail work the user already received. Logged rather
    // than swallowed, because a meter that silently stops counting is a
    // billing problem nobody notices.
    console.error(`[usage] could not record ${meter} for ${uid}: ${(err as Error).message}`);
  }
}
