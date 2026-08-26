import { FieldValue } from "firebase-admin/firestore";
import { ROUTES, type FailureKind } from "@alltheway/contracts";

import { recoveries } from "../firestore.js";

/**
 * Recording what happened after a failure.
 *
 * ## Offered is written before taken
 *
 * The row is created when the routes are shown, not when one is chosen. That
 * way "shown three options and picked none" is a recorded outcome rather than
 * an absence — and it is the most interesting outcome of all, because it means
 * every route we offered was wrong.
 *
 * ## No free text
 *
 * `routeTaken` is validated against the routes that were offered for that
 * failure. A caller cannot record an arbitrary string, which keeps this
 * analysable and stops it becoming a second, informal event log.
 */

export async function recordOffered(
  uid: string,
  turnId: string,
  failureKind: FailureKind,
): Promise<string> {
  const doc = await recoveries(uid).add({
    turnId,
    failureKind,
    routeOffered: ROUTES[failureKind].map((r) => r.id),
    // Null until someone chooses. Distinguishable from "not recorded", which
    // is what an absent field would be.
    routeTaken: null,
    at: FieldValue.serverTimestamp(),
  });
  return doc.id;
}

export async function recordTaken(
  uid: string,
  recoveryId: string,
  routeId: string,
): Promise<boolean> {
  const ref = recoveries(uid).doc(recoveryId);
  const doc = await ref.get();
  if (!doc.exists) return false;

  const offered = doc.get("routeOffered");
  if (!Array.isArray(offered) || !offered.includes(routeId)) {
    // A route that was never offered cannot have been taken. Accepting it
    // would let a bug write a plausible-looking lie into the one record that
    // tells us what users actually wanted.
    return false;
  }

  await ref.update({ routeTaken: routeId });
  return true;
}
