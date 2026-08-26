import { VisualPreferenceSchema, type VisualPreference } from "@alltheway/contracts";
import { FieldValue } from "firebase-admin/firestore";

import { visualPreferences } from "../firestore.js";

/**
 * Brand memory: what this user's work looks like.
 *
 * ## Why it is remembered at all
 *
 * Asking "what palette?" before every image is the behaviour of a tool. Getting
 * it wrong the same way every time is the behaviour of a worse one. So a
 * correction is kept, applied to the next generation, and shown back in the
 * Cognitive Profile where it can be undone.
 *
 * ## Reverting is a stamp, never a delete
 *
 * Same rule as the Feedback Ledger. A user who reverts a preference is giving
 * feedback, and a system that erased the record could not tell the difference
 * between "never learned this" and "learned it and was wrong" — which is
 * exactly the distinction worth keeping.
 */

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export async function listVisualPreferences(uid: string): Promise<VisualPreference[]> {
  const snap = await visualPreferences(uid).get();
  return snap.docs
    .map((d) =>
      VisualPreferenceSchema.parse({
        id: d.id,
        ...d.data(),
        swatches: d.get("swatches") ?? [],
        revertedAt: toIsoOrNull(d.get("revertedAt")),
      }),
    )
    .filter((p) => p.revertedAt === null);
}

export async function revertVisualPreference(uid: string, id: string): Promise<boolean> {
  const ref = visualPreferences(uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.update({ revertedAt: FieldValue.serverTimestamp() });
  return true;
}

/**
 * The remembered preferences, phrased for a generation prompt.
 *
 * Deliberately appended to the user's prompt rather than merged into it. A
 * preference must never be able to change *what* was asked for — only how it
 * looks — and text that is concatenated after the request cannot quietly
 * rewrite the request. It also means one bad remembered preference degrades an
 * image rather than producing the wrong thing entirely.
 *
 * Returns an empty string when nothing is remembered, so a new user's first
 * image is not shaped by a default someone invented.
 */
export async function styleFor(uid: string): Promise<string> {
  const active = await listVisualPreferences(uid);
  if (active.length === 0) return "";

  const clauses = active.map((p) =>
    p.swatches.length > 0 ? `${p.value} (${p.swatches.join(", ")})` : p.value,
  );
  return `Follow these visual preferences: ${clauses.join("; ")}.`;
}
