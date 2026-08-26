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
export const artifactVersions = (uid: string, artifactId: string) =>
  artifacts(uid).doc(artifactId).collection("versions");
