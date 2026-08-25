import {
  WatcherRunSchema,
  WatcherSchema,
  type Watcher,
  type WatcherRun,
} from "@alltheway/contracts";
import { FieldValue } from "firebase-admin/firestore";

import { runs, watchers } from "../firestore.js";

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export async function listWatchers(uid: string): Promise<Watcher[]> {
  const snap = await watchers(uid).orderBy("name").get();
  return snap.docs.map((d) =>
    WatcherSchema.parse({ id: d.id, ...d.data(), lastRunAt: toIsoOrNull(d.get("lastRunAt")) }),
  );
}

export async function listRuns(uid: string, limit = 10): Promise<WatcherRun[]> {
  const snap = await runs(uid).orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) =>
    WatcherRunSchema.parse({ id: d.id, ...d.data(), at: toIsoOrNull(d.get("at")) ?? new Date(0).toISOString() }),
  );
}

export async function setWatcherRunning(
  uid: string,
  id: string,
  running: boolean,
): Promise<Watcher | null> {
  const ref = watchers(uid).doc(id);
  const existing = await ref.get();
  if (!existing.exists) return null;

  await ref.update({ running, updatedAt: FieldValue.serverTimestamp() });
  const doc = await ref.get();
  return WatcherSchema.parse({ id: doc.id, ...doc.data(), lastRunAt: toIsoOrNull(doc.get("lastRunAt")) });
}
