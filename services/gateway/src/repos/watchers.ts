import {
  CreateWatcherSchema,
  WatcherRunSchema,
  WatcherSchema,
  type CreateWatcher,
  type Watcher,
  type WatcherRun,
} from "@alltheway/contracts";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db, runs, watchers } from "../firestore.js";

/** Pointers only. Instruction text lives under the user, never here. */
export const scheduleIndex = () => db.collection("watcherSchedule");

export const scheduleDocId = (uid: string, watcherId: string) => `${uid}_${watcherId}`;

export const MIN_INTERVAL_MINUTES = 60;

const toIsoOrNull = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

function asWatcher(id: string, data: FirebaseFirestore.DocumentData): Watcher {
  return WatcherSchema.parse({
    id,
    ...data,
    lastRunAt: toIsoOrNull(data.lastRunAt),
  });
}

export function triggerLabel(
  kind: CreateWatcher["triggerKind"],
  intervalMinutes: number | null,
): string {
  if (kind === "session_ended") return "When a piece of work ends";
  if (intervalMinutes === 60) return "Every hour";
  if (intervalMinutes === 1440) return "Every weekday morning";
  return `Every ${intervalMinutes ?? MIN_INTERVAL_MINUTES} minutes`;
}

export async function listWatchers(uid: string): Promise<Watcher[]> {
  const snap = await watchers(uid).orderBy("name").get();
  return snap.docs.map((d) => asWatcher(d.id, d.data()));
}

export async function listRuns(uid: string, limit = 10): Promise<WatcherRun[]> {
  const snap = await runs(uid).orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) =>
    WatcherRunSchema.parse({
      id: d.id,
      ...d.data(),
      at: toIsoOrNull(d.get("at")) ?? new Date(0).toISOString(),
    }),
  );
}

export async function createWatcher(uid: string, input: unknown): Promise<Watcher> {
  const body = CreateWatcherSchema.parse(input);
  const intervalMinutes =
    body.triggerKind === "schedule" ? (body.intervalMinutes ?? 1440) : null;
  if (body.triggerKind === "schedule" && (intervalMinutes ?? 0) < MIN_INTERVAL_MINUTES) {
    throw Object.assign(new Error("interval_too_short"), { code: "interval_too_short" });
  }

  const id = crypto.randomUUID();
  const trigger = triggerLabel(body.triggerKind, intervalMinutes);
  const nextRunAt =
    body.triggerKind === "schedule" && intervalMinutes
      ? Timestamp.fromMillis(Date.now() + intervalMinutes * 60_000)
      : null;

  const row = {
    name: body.name,
    instruction: body.instruction,
    trigger,
    triggerKind: body.triggerKind,
    intervalMinutes,
    ceiling: body.ceiling,
    running: true,
    lastRunAt: null,
    nextRunAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(watchers(uid).doc(id), row);
  if (nextRunAt) {
    batch.set(scheduleIndex().doc(scheduleDocId(uid, id)), {
      uid,
      watcherId: id,
      nextRunAt,
      running: true,
      intervalMinutes,
    });
  }
  await batch.commit();

  return asWatcher(id, { ...row, lastRunAt: null });
}

export async function setWatcherRunning(
  uid: string,
  id: string,
  running: boolean,
): Promise<Watcher | null> {
  const ref = watchers(uid).doc(id);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const intervalMinutes = existing.get("intervalMinutes") as number | null;
  const triggerKind = existing.get("triggerKind") as string | undefined;
  const indexRef = scheduleIndex().doc(scheduleDocId(uid, id));
  const batch = db.batch();

  if (triggerKind === "session_ended") {
    batch.update(ref, { running, updatedAt: FieldValue.serverTimestamp() });
  } else if (running) {
    const minutes =
      typeof intervalMinutes === "number" && intervalMinutes >= MIN_INTERVAL_MINUTES
        ? intervalMinutes
        : 1440;
    const nextRunAt = Timestamp.fromMillis(Date.now() + minutes * 60_000);
    batch.update(ref, {
      running,
      nextRunAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      indexRef,
      {
        uid,
        watcherId: id,
        running: true,
        intervalMinutes: minutes,
        nextRunAt,
      },
      { merge: true },
    );
  } else {
    batch.update(ref, { running, updatedAt: FieldValue.serverTimestamp() });
    batch.set(indexRef, { running: false }, { merge: true });
  }

  await batch.commit();
  const doc = await ref.get();
  return asWatcher(doc.id, doc.data() ?? {});
}
