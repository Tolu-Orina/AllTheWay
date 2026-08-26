import { FieldValue, getFirestore } from "firebase-admin/firestore";

/**
 * Which user a meeting belongs to.
 *
 * ## The problem this solves
 *
 * A Workspace Events push says "conference X ended". It does not say whose
 * meeting that was, and it cannot: the subscription is a Google-side object and
 * the delivery is to a project topic, not to a person. Without a way back to a
 * user there is nothing to do with the event — no meeting record to update, no
 * credential to fetch the transcript with, and no one to show it to.
 *
 * So the mapping is recorded at the only moment it is known: when the user's
 * own client starts a meeting, authenticated as them.
 *
 * ## Why this one collection is at the root
 *
 * Everything a user owns lives under `users/{uid}/…` (§1.4), and this is
 * deliberately not that. It is a *reverse index*: an opaque Google-side space
 * id against a uid, looked up by a process that does not yet know the uid —
 * which is precisely the lookup a path-scoped collection cannot serve.
 *
 * It follows the shape already used for `connectorStates` and `authCodes`:
 * a random key against a uid, holding no content. Nothing about the meeting is
 * stored here — no title, no participants, no notes. Those stay under the user,
 * where a leak of this index would still not reach them.
 */

const db = () => getFirestore();

//: Space id -> uid. Not `meetings`, which is user-owned and path-scoped; the
//: names are kept clearly different so neither is mistaken for the other.
const SPACES = "meetSpaceOwners";

export async function rememberSpace(
  uid: string,
  spaceId: string,
  meetingId: string,
): Promise<void> {
  if (!spaceId) return;
  await db()
    .collection(SPACES)
    .doc(spaceId)
    .set({ uid, meetingId, at: FieldValue.serverTimestamp() }, { merge: true });
}

export interface SpaceOwner {
  uid: string;
  meetingId: string;
}

/**
 * Who owns this space, or null.
 *
 * Null is an ordinary answer, not a fault: events arrive for spaces nobody has
 * connected, and for spaces whose mapping has aged out. The caller acknowledges
 * those rather than retrying, because no amount of redelivery will produce a
 * user who was never recorded.
 */
export async function ownerOfSpace(spaceId: string): Promise<SpaceOwner | null> {
  if (!spaceId) return null;

  const doc = await db().collection(SPACES).doc(spaceId).get();
  if (!doc.exists) return null;

  const uid = doc.get("uid");
  const meetingId = doc.get("meetingId");
  if (typeof uid !== "string" || !uid) return null;

  return { uid, meetingId: typeof meetingId === "string" ? meetingId : spaceId };
}
