import { FieldValue } from "firebase-admin/firestore";

import { userDoc } from "../firestore.js";
import { parseHat, type ActiveHat } from "../hat.js";

const ref = (uid: string) => userDoc(uid).collection("settings").doc("hat");

/**
 * Today's hat, stored on the person, not the browser.
 *
 * A correction reads this at write time so the preference row is scoped
 * to the filter they were actually looking at, not whatever the client
 * claims in the request body.
 */
export async function getActiveHat(uid: string): Promise<ActiveHat> {
  const doc = await ref(uid).get();
  if (!doc.exists) return null;
  return parseHat(doc.get("hat"));
}

export async function setActiveHat(uid: string, hat: ActiveHat): Promise<ActiveHat> {
  await ref(uid).set(
    {
      hat,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return hat;
}
