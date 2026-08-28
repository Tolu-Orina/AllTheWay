import { ConceptSchema, type Concept } from "@alltheway/contracts";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

import { concepts } from "../firestore.js";

const toIso = (value: unknown, fallback: string): string =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : typeof value === "string" && value
      ? value
      : fallback;

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

/**
 * Stable id for one concept in one document. The same clause asked about
 * twice is one row, not two.
 */
export function conceptId(documentId: string, label: string): string {
  const stem = `${documentId}:${label.trim().toLowerCase()}`;
  const digest = createHash("sha256").update(stem).digest("hex").slice(0, 16);
  return `c-${digest}`;
}

export async function listConcepts(uid: string): Promise<Concept[]> {
  const snap = await concepts(uid).get();
  return snap.docs
    .map((d) =>
      ConceptSchema.parse({
        id: d.id,
        label: d.get("label") ?? "",
        documentId: d.get("documentId") ?? "",
        encountered: d.get("encountered") ?? 0,
        reasked: d.get("reasked") ?? 0,
        reexplained: d.get("reexplained") ?? 0,
        confidence: d.get("confidence") ?? 0.5,
        lastSeenAt: toIso(d.get("lastSeenAt"), new Date().toISOString()),
        revertedAt: toIsoOrNull(d.get("revertedAt")),
      }),
    )
    .filter((c) => c.revertedAt === null);
}

/**
 * The two writers. `reask` is "explain this again". `miss` is a check that
 * did not land. A hit raises confidence on an existing row and writes nothing
 * if there is no row — success is not a reason to invent a weakness.
 */
export async function recordConcept(
  uid: string,
  input: { documentId: string; label: string; kind: "reask" | "miss" | "hit" },
): Promise<Concept | null> {
  const documentId = input.documentId.trim();
  const label = input.label.trim();
  if (!documentId || !label) return null;

  const id = conceptId(documentId, label);
  const ref = concepts(uid).doc(id);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;

  if (input.kind === "hit") {
    if (!existing || existing.revertedAt) return null;
    const confidence = Math.min(1, Number(existing.confidence ?? 0.5) + 0.15);
    await ref.set(
      {
        confidence,
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return listOne(uid, id);
  }

  const encountered = Number(existing?.encountered ?? 0) + 1;
  const reasked =
    input.kind === "reask" ? Number(existing?.reasked ?? 0) + 1 : Number(existing?.reasked ?? 0);
  const reexplained =
    input.kind === "reask" ? Number(existing?.reexplained ?? 0) + 1 : Number(existing?.reexplained ?? 0);
  const confidence = Math.max(
    0,
    Number(existing?.confidence ?? 0.5) - (input.kind === "miss" ? 0.2 : 0.1),
  );

  await ref.set(
    {
      label,
      documentId,
      encountered,
      reasked,
      reexplained,
      confidence,
      lastSeenAt: FieldValue.serverTimestamp(),
      revertedAt: null,
    },
    { merge: true },
  );
  return listOne(uid, id);
}

export async function revertConcept(uid: string, id: string): Promise<boolean> {
  const ref = concepts(uid).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.update({ revertedAt: FieldValue.serverTimestamp() });
  return true;
}

async function listOne(uid: string, id: string): Promise<Concept | null> {
  const rows = await listConcepts(uid);
  return rows.find((c) => c.id === id) ?? null;
}
