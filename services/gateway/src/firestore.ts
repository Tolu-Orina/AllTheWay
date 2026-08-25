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
/** The Feedback Ledger. One collection for spoken and typed turns alike —
 *  the manifest is explicit that there is no separate "voice memory". */
export const ledger = (uid: string) => userDoc(uid).collection("ledger");
