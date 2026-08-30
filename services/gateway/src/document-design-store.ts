import { FieldValue } from "firebase-admin/firestore";

import { db } from "./firestore.js";
import { SLIDE_DESIGN_COLLECTION, slideKey, type SlideDesignNode } from "./document-design.js";

/**
 * Product catalog writes. slideDesigns is not a user collection — the
 * tenant-isolation check allows it at the root the same way watcherSchedule
 * is a project pointer.
 */

export async function upsertSlideDesign(node: SlideDesignNode): Promise<void> {
  const { embedding, ...rest } = node;
  const payload: Record<string, unknown> = { ...rest };
  if (embedding?.length) {
    payload.embedding = FieldValue.vector(embedding);
  }
  await db.collection(SLIDE_DESIGN_COLLECTION).doc(node.id).set(payload, { merge: true });
}

export async function loadThemeSlides(themeId: string, slideCount = 30): Promise<SlideDesignNode[]> {
  const refs = Array.from({ length: Math.max(1, Math.min(slideCount, 40)) }, (_, i) =>
    db.collection(SLIDE_DESIGN_COLLECTION).doc(`${themeId}:${slideKey(i)}`),
  );
  const snaps = await db.getAll(...refs);
  return snaps
    .filter((snap) => snap.exists)
    .map((snap) => snap.data() as SlideDesignNode)
    .filter((node) => node?.id)
    .sort((a, b) => a.slideIndex - b.slideIndex);
}
