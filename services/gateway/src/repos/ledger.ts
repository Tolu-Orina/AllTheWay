import { FieldValue } from "firebase-admin/firestore";

import { ledger } from "../firestore.js";

/**
 * The Feedback Ledger (FR-V5, FR-5).
 *
 * What was confirmed, what was declined, what was corrected — in one place,
 * with the same structure whether the turn was spoken or typed. The manifest is
 * explicit that there is no separate "voice memory", so `modality` is a field
 * on one record rather than a second collection.
 *
 * ## Append-only
 *
 * Nothing here updates or deletes. A user who declines something and later
 * agrees produces two entries, not one entry that changed its mind — because
 * the question the ledger answers is "what happened", and an overwritten record
 * cannot answer it. This mirrors `preferences`, where a revert is a new field
 * rather than a deletion.
 *
 * ## Why the summary is stored, not regenerated
 *
 * The user agreed to a specific sentence. Regenerating it later from the plan
 * would produce what the model *would say now*, which is not what they agreed
 * to. The exact wording is the evidence.
 */

export type LedgerKind = "confirmed" | "declined" | "corrected";

export type LedgerEntry = {
  sessionId: string;
  kind: LedgerKind;
  /** Exactly what the user was asked, verbatim. */
  summary: string;
  /** The steps the decision covered. */
  actions: { label: string; action: string; reason: string }[];
  modality: "voice" | "text";
  /** Transcriber confidence, when the turn was spoken. */
  confidence?: number;
  /** What they said to do instead. Only on `corrected`. */
  now?: string;
};

export async function record(uid: string, entry: LedgerEntry): Promise<string> {
  const doc = await ledger(uid).add({
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
  return doc.id;
}

export async function listRecent(uid: string, limit = 50) {
  // `at` alone is a single-field index, which Firestore provides automatically.
  const snap = await ledger(uid).orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    at: d.get("at")?.toDate?.()?.toISOString() ?? null,
  }));
}
