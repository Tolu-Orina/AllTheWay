import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { env } from "./env.js";

/**
 * Admin SDK, pointed at the emulator when FIRESTORE_EMULATOR_HOST is set and at
 * the real project otherwise. The same code runs in both — nothing branches on
 * environment beyond this file.
 */
if (getApps().length === 0) {
  // The emulator authenticates nothing, so no credential is supplied at all —
  // handing it a fake one makes firebase-admin try to parse a private key and
  // fail. The real project uses Application Default Credentials (gcloud auth
  // application-default login locally, the service account on Cloud Run). No
  // key files, ever.
  initializeApp(
    env.usingEmulator
      ? { projectId: env.projectId }
      : { projectId: env.projectId, credential: applicationDefault() },
  );
}

export const db = getFirestore();

db.settings({ ignoreUndefinedProperties: true });

/** Per-user subcollections: the natural boundary for security rules. */
export const userDoc = (uid: string) => db.collection("users").doc(uid);
export const sessions = (uid: string) => userDoc(uid).collection("sessions");
export const watchers = (uid: string) => userDoc(uid).collection("watchers");
export const runs = (uid: string) => userDoc(uid).collection("runs");
export const preferences = (uid: string) => userDoc(uid).collection("preferences");

// Brand memory. Path-scoped under the user like everything else: a palette is
// as much a fingerprint of a company's work as a document is, and a root-level
// collection here would be the same cross-tenant hazard in a prettier form.
export const visualPreferences = (uid: string) =>
  userDoc(uid).collection("visualPreferences");
/** The Feedback Ledger. One collection for spoken and typed turns alike —
 *  the manifest is explicit that there is no separate "voice memory". */
export const ledger = (uid: string) => userDoc(uid).collection("ledger");

/**
 * Artifacts, and their append-only version history.
 *
 * Under the user's path like everything else here, not in a flat collection
 * with an owner field. That is the difference between a scope a query cannot
 * escape and a filter someone has to remember — and it is why
 * `scripts/check-tenant-isolation.py` forbids `db.collection("artifacts")`.
 *
 * Sharing (v3 Phase E) still works across this path: a security rule can grant
 * a non-owner read on `users/{owner}/artifacts/{id}` without the reader's uid
 * appearing in it. A scoped path constrains queries, not rules.
 */
export const artifacts = (uid: string) => userDoc(uid).collection("artifacts");

/**
 * Who an artifact is shared with. A property of the artifact, so it lives under
 * the artifact — `users/{ownerUid}/artifacts/{id}/shares/{granteeUid}`.
 *
 * This is the authoritative record: the one consulted to decide whether a read
 * is permitted. See `sharedWithMe` for why there is a second copy, and why it
 * is deliberately not the one that decides.
 */
export const shares = (ownerUid: string, artifactId: string) =>
  artifacts(ownerUid).doc(artifactId).collection("shares");

/**
 * The grantee's index of what has been shared with them.
 *
 * ## Why this exists at all
 *
 * The authoritative share sits under the *owner's* path, and a grantee does not
 * know who the owners are. Listing "what has been shared with me" from that
 * record alone would need a query across every user's subtree — a collection
 * group query, which is the one thing forbidden outright, because it spans
 * every tenant by definition.
 *
 * So the fact is written twice: once where it belongs, and once where it can be
 * found. Both writes happen in a single batch, so a share is never half-created.
 *
 * ## It points; it does not permit
 *
 * This index says *look here*. The share document under the owner says *you
 * may*. Every read re-checks the authoritative record, so a stale or forged
 * index entry grants nothing — it only produces a lookup that then refuses.
 * Getting that backwards would make the cheap, denormalised copy the thing
 * standing between two tenants.
 */
export const sharedWithMe = (granteeUid: string) =>
  userDoc(granteeUid).collection("sharedWithMe");

/**
 * Web push tokens, one document per browser.
 *
 * Path-scoped like everything else. A token is not secret in the way a
 * credential is — it authorises sending *to* a device, not acting *as* anyone —
 * but it identifies a person's browser, and that is enough to keep it under
 * them rather than in a root collection keyed by token.
 *
 * The document id is the token itself, which makes re-registering the same
 * browser idempotent: FCM hands back the same token until it rotates, and an
 * `add()` here would accumulate a row per page load.
 */
export const pushTokens = (uid: string) => userDoc(uid).collection("pushTokens");

/**
 * What was offered when something failed, and what the person did next.
 *
 * Recorded because **which route a user takes after a failure is the most
 * honest product feedback available** — it says what they actually wanted at
 * the moment the system could not deliver it. A person who always picks "I'll
 * do this one myself" over "connect the account" is telling us something no
 * survey would.
 */
export const recoveries = (uid: string) => userDoc(uid).collection("recoveries");

/**
 * Comments on an artifact, anchored to a version.
 *
 * Under the artifact rather than under the author: a comment is part of the
 * conversation about the thing, and everyone permitted to see the thing should
 * see it. Storing them under each author would scatter one discussion across
 * several users' subtrees and make it unreadable without the query that is
 * forbidden.
 */
export const comments = (ownerUid: string, artifactId: string) =>
  artifacts(ownerUid).doc(artifactId).collection("comments");
export const artifactVersions = (uid: string, artifactId: string) =>
  artifacts(uid).doc(artifactId).collection("versions");

/**
 * Studio video jobs. Path-scoped like everything else: an operation name is
 * a handle on a generation this user paid to start, and a root collection
 * would be the same cross-tenant hazard as a flat artifacts list.
 */
export const studioJobs = (uid: string) => userDoc(uid).collection("studioJobs");
