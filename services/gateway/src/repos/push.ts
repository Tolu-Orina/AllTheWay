import { FieldValue } from "firebase-admin/firestore";

import { pushTokens } from "../firestore.js";

/**
 * Where a person's notifications go.
 *
 * ## A token is a device, not a person
 *
 * The same user on a laptop and a phone has two, and both should ring. So this
 * is a collection rather than a field, and sending fans out across all of them.
 *
 * ## Dead tokens are deleted, promptly
 *
 * FCM answers `UNREGISTERED` or `INVALID_ARGUMENT` for a token whose browser
 * has cleared its site data or revoked permission. Those must be removed on the
 * spot: kept, they make every future send report failures, and a send that
 * always reports failures is a send nobody looks at.
 *
 * This is also the one place in the product where deletion is right rather than
 * a stamp. A revoked push token records nothing worth keeping — there is no
 * decision behind it, only a browser that no longer exists.
 */

//: Firestore document ids cannot contain "/" and are capped at 1500 bytes. FCM
//: tokens are long and contain ":" and "-" but not "/", so they are usable
//: directly — checked rather than assumed, because a token that silently fails
//: to store is a user whose notifications never arrive and never error.
function usableAsId(token: string): boolean {
  return token.length > 0 && token.length <= 1500 && !token.includes("/");
}

export async function registerToken(uid: string, token: string): Promise<boolean> {
  if (!usableAsId(token)) return false;

  await pushTokens(uid).doc(token).set(
    {
      token,
      // Refreshed on every registration. A token nobody has re-registered in
      // months is a browser that is gone, and this is what makes that visible.
      seenAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

export async function removeToken(uid: string, token: string): Promise<void> {
  if (!usableAsId(token)) return;
  await pushTokens(uid).doc(token).delete();
}

export async function listTokens(uid: string): Promise<string[]> {
  const snap = await pushTokens(uid).get();
  return snap.docs.map((d) => String(d.get("token") ?? d.id)).filter(Boolean);
}
