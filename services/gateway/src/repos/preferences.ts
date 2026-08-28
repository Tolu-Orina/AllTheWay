import { LearnedPreferenceSchema, type LearnedPreference } from "@alltheway/contracts";
import { FieldValue } from "firebase-admin/firestore";

import { preferences } from "../firestore.js";
import { appliesHat, type ActiveHat } from "../hat.js";

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export type ListPreferencesOpts = {
  hat?: ActiveHat;
  /** Turn injection skips proposed synth rows. You lists them so they can be accepted. */
  forTurn?: boolean;
};

export async function listPreferences(
  uid: string,
  opts: ListPreferencesOpts = {},
): Promise<LearnedPreference[]> {
  const snap = await preferences(uid).get();
  return snap.docs
    .map((d) =>
      LearnedPreferenceSchema.parse({
        id: d.id,
        ...d.data(),
        hat: d.get("hat") ?? null,
        proposed: d.get("proposed") ?? false,
        revertedAt: toIsoOrNull(d.get("revertedAt")),
      }),
    )
    .filter((p) => p.revertedAt === null)
    .filter((p) => (opts.forTurn ? p.proposed !== true : true))
    .filter((p) => (opts.forTurn ? appliesHat(p.hat ?? null, opts.hat ?? null) : true));
}

export async function revertPreference(uid: string, id: string): Promise<boolean> {
  const ref = preferences(uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.update({ revertedAt: FieldValue.serverTimestamp(), proposed: false });
  return true;
}

/**
 * Activate a sleep-time proposal. A human correction is already active.
 * Accepting one that is not proposed is a no-op so a double-click cannot
 * invent a second meaning.
 */
export async function acceptPreference(uid: string, id: string): Promise<boolean> {
  const ref = preferences(uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  if (doc.get("revertedAt")) return false;
  if (doc.get("proposed") !== true) return true;
  await ref.update({ proposed: false });
  return true;
}
