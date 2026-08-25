import {
  SessionDetailSchema,
  SessionSchema,
  type Session,
  type SessionDetail,
} from "@alltheway/contracts";

import { sessions } from "../firestore.js";

const toIso = (value: unknown): string =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : new Date(0).toISOString();

export async function listSessions(uid: string): Promise<Session[]> {
  const snap = await sessions(uid).orderBy("updatedAt", "desc").limit(50).get();
  // Parsed on the way out: a malformed document fails here, in one place,
  // rather than as a mystery undefined in the UI.
  return snap.docs.map((d) =>
    SessionSchema.parse({ id: d.id, ...d.data(), updatedAt: toIso(d.get("updatedAt")) }),
  );
}

export async function getSession(uid: string, id: string): Promise<SessionDetail | null> {
  const doc = await sessions(uid).doc(id).get();
  if (!doc.exists) return null;
  return SessionDetailSchema.parse({
    id: doc.id,
    ...doc.data(),
    updatedAt: toIso(doc.get("updatedAt")),
  });
}
