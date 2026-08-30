import {
  PersonSchema,
  PlaceSchema,
  ProposedCommitmentSchema,
  ReminderSchema,
  RhythmSchema,
  TaskSchema,
  type Day,
  type Person,
  type Place,
  type ProposedCommitment,
  type Reminder,
  type Rhythm,
  type Task,
} from "@alltheway/contracts";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db, userDoc } from "../firestore.js";

/**
 * People, places, rhythms, reminders, proposed commitments.
 *
 * Path-scoped under the user. Children's names here are ordinary PII in *her*
 * account — not child accounts. reminderDue is a pointer collection, like
 * watcherSchedule: uid + reminderId + fireAt, never instruction text.
 */

export const people = (uid: string) => userDoc(uid).collection("people");
export const places = (uid: string) => userDoc(uid).collection("places");
export const rhythms = (uid: string) => userDoc(uid).collection("rhythms");
export const reminders = (uid: string) => userDoc(uid).collection("reminders");
export const proposedCommitments = (uid: string) => userDoc(uid).collection("proposedCommitments");
export const tasks = (uid: string) => userDoc(uid).collection("tasks");
export const reminderDue = () => db.collection("reminderDue");

export const reminderDueId = (uid: string, reminderId: string) => `${uid}_${reminderId}`;

const toIso = (value: unknown, fallback = ""): string => {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return fallback;
};

export async function listPeople(uid: string): Promise<Person[]> {
  const snap = await people(uid).orderBy("name").get();
  return snap.docs.map((d) => PersonSchema.parse({ id: d.id, ...d.data() }));
}

export async function createPerson(
  uid: string,
  input: { name: string; relation?: string },
): Promise<Person> {
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("name_required"), { code: "invalid_request" });
  const ref = people(uid).doc();
  const row = { name, relation: (input.relation ?? "").trim() };
  await ref.set({ ...row, createdAt: FieldValue.serverTimestamp() });
  return PersonSchema.parse({ id: ref.id, ...row });
}

export async function listPlaces(uid: string): Promise<Place[]> {
  const snap = await places(uid).orderBy("label").get();
  return snap.docs.map((d) => PlaceSchema.parse({ id: d.id, ...d.data() }));
}

export async function createPlace(
  uid: string,
  input: { label: string; bufferMinutes?: number; hat?: Place["hat"] },
): Promise<Place> {
  const label = input.label.trim();
  if (!label) throw Object.assign(new Error("label_required"), { code: "invalid_request" });
  const ref = places(uid).doc();
  const row = {
    label,
    bufferMinutes: input.bufferMinutes ?? 15,
    hat: input.hat ?? "home",
  };
  await ref.set({ ...row, createdAt: FieldValue.serverTimestamp() });
  return PlaceSchema.parse({ id: ref.id, ...row });
}

export async function listRhythms(uid: string): Promise<Rhythm[]> {
  const snap = await rhythms(uid).get();
  return snap.docs.map((d) => RhythmSchema.parse({ id: d.id, ...d.data() }));
}

export async function createRhythm(
  uid: string,
  input: {
    title: string;
    hat: Rhythm["hat"];
    weekdays: number[];
    time: string;
    timeZone?: string;
    personId?: string;
    placeId?: string;
  },
): Promise<Rhythm> {
  const title = input.title.trim();
  if (!title) throw Object.assign(new Error("title_required"), { code: "invalid_request" });
  if (!/^\d{1,2}:\d{2}$/.test(input.time.trim())) {
    throw Object.assign(new Error("time_required"), { code: "invalid_request" });
  }
  const ref = rhythms(uid).doc();
  const row = {
    title,
    hat: input.hat,
    weekdays: input.weekdays,
    time: input.time.trim(),
    timeZone: input.timeZone ?? "Europe/London",
    personId: input.personId ?? "",
    placeId: input.placeId ?? "",
  };
  await ref.set({ ...row, createdAt: FieldValue.serverTimestamp() });
  return RhythmSchema.parse({ id: ref.id, ...row });
}

export async function deleteRhythm(uid: string, id: string): Promise<void> {
  await rhythms(uid).doc(id).delete();
}

export async function listReminders(uid: string, states: Reminder["state"][] = ["scheduled"]): Promise<Reminder[]> {
  const snap = await reminders(uid).get();
  return snap.docs
    .map((d) =>
      ReminderSchema.parse({
        id: d.id,
        ...d.data(),
        fireAt: toIso(d.get("fireAt"), new Date(0).toISOString()),
      }),
    )
    .filter((row) => states.includes(row.state))
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt));
}

export async function createReminder(
  uid: string,
  input: {
    id?: string;
    title: string;
    kind: Reminder["kind"];
    fireAt: string;
    hat?: Reminder["hat"];
    rhythmId?: string;
    commitmentId?: string;
    repeat?: Reminder["repeat"];
  },
): Promise<Reminder> {
  const title = input.title.trim();
  const fire = new Date(input.fireAt);
  if (!title || Number.isNaN(fire.getTime())) {
    throw Object.assign(new Error("reminder_invalid"), { code: "invalid_request" });
  }
  const ref = input.id ? reminders(uid).doc(input.id) : reminders(uid).doc();
  const existing = await ref.get();
  if (existing.exists) {
    return ReminderSchema.parse({
      id: ref.id,
      ...existing.data(),
      fireAt: toIso(existing.get("fireAt"), fire.toISOString()),
    });
  }
  const row = {
    title,
    kind: input.kind,
    fireAt: Timestamp.fromDate(fire),
    state: "scheduled" as const,
    hat: input.hat ?? "home",
    rhythmId: input.rhythmId ?? "",
    commitmentId: input.commitmentId ?? "",
    repeat: input.repeat ?? "once",
  };
  await ref.set({ ...row, createdAt: FieldValue.serverTimestamp() });
  await reminderDue()
    .doc(reminderDueId(uid, ref.id))
    .set({
      uid,
      reminderId: ref.id,
      fireAt: Timestamp.fromDate(fire),
      kind: input.kind,
    });
  return ReminderSchema.parse({
    id: ref.id,
    ...row,
    fireAt: fire.toISOString(),
  });
}

export async function listTasks(uid: string): Promise<Task[]> {
  const snap = await tasks(uid).orderBy("createdAt", "desc").limit(200).get();
  return snap.docs.flatMap((d) => {
    const parsed = TaskSchema.safeParse({
      id: d.id,
      ...d.data(),
      createdAt: toIso(d.get("createdAt"), new Date(0).toISOString()),
      completedAt: d.get("completedAt") ? toIso(d.get("completedAt")) : null,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function createTask(uid: string, text: string, hat?: Task["hat"]): Promise<Task> {
  const trimmed = text.trim();
  if (!trimmed) throw Object.assign(new Error("task_invalid"), { code: "invalid_request" });
  const ref = tasks(uid).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({ text: trimmed, hat: hat ?? null, completedAt: null, createdAt: now });
  return TaskSchema.parse({
    id: ref.id,
    text: trimmed,
    hat: hat ?? null,
    completedAt: null,
    createdAt: new Date().toISOString(),
  });
}

export async function completeTask(uid: string, id: string): Promise<Task | null> {
  const ref = tasks(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const now = new Date();
  await ref.update({ completedAt: Timestamp.fromDate(now) });
  return TaskSchema.parse({
    id,
    ...snap.data(),
    createdAt: toIso(snap.get("createdAt"), new Date(0).toISOString()),
    completedAt: now.toISOString(),
  });
}

export async function deleteTask(uid: string, id: string): Promise<boolean> {
  const ref = tasks(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

export async function dismissReminder(uid: string, id: string): Promise<Reminder | null> {
  const ref = reminders(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ state: "dismissed" });
  await reminderDue().doc(reminderDueId(uid, id)).delete().catch(() => undefined);
  return ReminderSchema.parse({
    id,
    ...snap.data(),
    fireAt: toIso(snap.get("fireAt")),
    state: "dismissed",
  });
}

export async function markReminderFired(uid: string, id: string): Promise<void> {
  await reminders(uid).doc(id).update({ state: "fired", firedAt: FieldValue.serverTimestamp() });
  await reminderDue().doc(reminderDueId(uid, id)).delete().catch(() => undefined);
}

export async function ensureLeaveReminders(uid: string, day: Day): Promise<void> {
  const now = Date.now();
  for (const item of day.hours) {
    if (!item.leaveAt) continue;
    const leave = Date.parse(item.leaveAt);
    if (!Number.isFinite(leave) || leave < now - 60_000) continue;
    const id = `leave_${item.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
    await createReminder(uid, {
      id,
      title: item.title,
      kind: "leave",
      fireAt: item.leaveAt,
      hat: item.hat,
      commitmentId: item.id,
    });
  }
}

export async function listProposed(uid: string): Promise<ProposedCommitment[]> {
  const snap = await proposedCommitments(uid).get();
  return snap.docs
    .map((d) => ProposedCommitmentSchema.parse({ id: d.id, ...d.data() }))
    .filter((row) => row.state === "proposed");
}

export async function createProposed(
  uid: string,
  input: {
    title: string;
    startsAt?: string | null;
    hat?: ProposedCommitment["hat"];
    sourceDocumentId?: string;
    sourceTitle?: string;
    detail?: string;
  },
): Promise<ProposedCommitment> {
  const ref = proposedCommitments(uid).doc();
  const row = {
    title: input.title.trim(),
    startsAt: input.startsAt ?? null,
    hat: input.hat ?? "home",
    sourceDocumentId: input.sourceDocumentId ?? "",
    sourceTitle: input.sourceTitle ?? "",
    state: "proposed" as const,
    detail: input.detail ?? "",
  };
  await ref.set({ ...row, createdAt: FieldValue.serverTimestamp() });
  return ProposedCommitmentSchema.parse({ id: ref.id, ...row });
}

export async function setProposedState(
  uid: string,
  id: string,
  state: "accepted" | "declined",
): Promise<ProposedCommitment | null> {
  const ref = proposedCommitments(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ state });
  return ProposedCommitmentSchema.parse({ id, ...snap.data(), state });
}
