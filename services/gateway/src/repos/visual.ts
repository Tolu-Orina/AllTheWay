import { VisualPreferenceSchema, type VisualPreference } from "@alltheway/contracts";
import { FieldValue } from "firebase-admin/firestore";

import { db, visualPreferences } from "../firestore.js";

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

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const HEX_ONE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export function swatchesIn(note: string): string[] {
  HEX.lastIndex = 0;
  return [...new Set(note.match(HEX) ?? [])];
}

/**
 * Which visual axis a correction is about. Matching is on the wording, not
 * on the artifact kind — a "too much blue" on a wireframe is a palette fact.
 */
export function visualAspect(note: string): string {
  const n = note.toLowerCase();
  if (/\b(corners?|radius|round(?:ed)?|sharp)\b/.test(n)) return "corners";
  if (/\b(font|typeface|typography|lettering)\b/.test(n)) return "typography";
  if (/\b(dense|clutter|spacing|compact|padding|margin)\b/.test(n)) return "density";
  if (
    /\b(colour|color|palette|neon|muted|swatch|hue|blue|red|green|yellow|pink)\b/.test(n) ||
    HEX_ONE.test(note)
  ) {
    return "palette";
  }
  return "look";
}

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
 * Learn from an artifact correction note.
 *
 * Empty notes write nothing: saving a version without saying what changed is
 * an edit, not a lesson. A second correction on the same aspect retires the
 * standing one (TEPA) rather than leaving two palettes in the prompt.
 */
export async function rememberVisual(uid: string, note: string): Promise<string | null> {
  const value = note.trim();
  if (!value) return null;

  const aspect = visualAspect(value);
  const swatches = swatchesIn(value);
  const col = visualPreferences(uid);
  const standing = await col.get();
  const ref = col.doc();
  const batch = db.batch();
  for (const doc of standing.docs) {
    const data = doc.data();
    if (data.revertedAt) continue;
    if (data.aspect !== aspect) continue;
    batch.update(doc.ref, {
      revertedAt: FieldValue.serverTimestamp(),
      supersededBy: ref.id,
    });
  }
  batch.set(ref, {
    aspect,
    value,
    swatches,
    evidence: `You corrected a version: ${value}`,
    revertedAt: null,
    supersededBy: null,
    source: "artifact",
    synthesisedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
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
