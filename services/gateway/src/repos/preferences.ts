import { LearnedPreferenceSchema, type LearnedPreference } from "@alltheway/contracts";
import { FieldValue } from "firebase-admin/firestore";

import { preferences } from "../firestore.js";

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export async function listPreferences(uid: string): Promise<LearnedPreference[]> {
  const snap = await preferences(uid).get();
  return snap.docs
    .map((d) =>
      LearnedPreferenceSchema.parse({
        id: d.id,
        ...d.data(),
        revertedAt: toIsoOrNull(d.get("revertedAt")),
      }),
    )
    // Reverted entries stay in Firestore: the Feedback Ledger is append-only,
    // so a correction is recorded rather than erased. They are simply not shown.
    .filter((p) => p.revertedAt === null);
}

export async function revertPreference(uid: string, id: string): Promise<boolean> {
  const ref = preferences(uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.update({ revertedAt: FieldValue.serverTimestamp() });
  return true;
}
