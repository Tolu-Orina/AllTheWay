import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { db } from "./firestore.js";
import {
  MIN_INTERVAL_MINUTES,
  createWatcher,
  scheduleDocId,
  scheduleIndex,
  setWatcherRunning,
} from "./repos/watchers.js";

const UID = `watchers-${Date.now()}`;

async function emulatorReachable(): Promise<boolean> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) return false;
  try {
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const live = await emulatorReachable();
if (!live) {
  console.warn("\n  [watchers] Firestore emulator not reachable — skipping.\n");
}
const emulated = { skip: !live };

test("a schedule under 60 minutes is refused", async () => {
  await assert.rejects(
    () =>
      createWatcher(UID, {
        name: "Too eager",
        instruction: "When anything happens, draft a reply",
        triggerKind: "schedule",
        intervalMinutes: 5,
        ceiling: "send_after_review",
      }),
    { name: "ZodError" },
  );
  assert.equal(MIN_INTERVAL_MINUTES, 60);
});

test("creating a schedule writes the due index", emulated, async () => {
  const uid = `${UID}-create`;
  const watcher = await createWatcher(uid, {
    name: "Morning catch-up",
    instruction: "When the day starts, draft what needs me",
    triggerKind: "schedule",
    intervalMinutes: 1440,
    ceiling: "send_after_review",
  });
  assert.equal(watcher.running, true);
  assert.equal(watcher.triggerKind, "schedule");
  assert.equal(watcher.intervalMinutes, 1440);

  const index = await scheduleIndex().doc(scheduleDocId(uid, watcher.id)).get();
  assert.equal(index.exists, true);
  assert.equal(index.get("uid"), uid);
  assert.equal(index.get("watcherId"), watcher.id);
  assert.equal(index.get("running"), true);
  assert.equal(index.get("instruction"), undefined);
  const next = index.get("nextRunAt") as { toDate?: () => Date };
  assert.ok(next && typeof next.toDate === "function");
  assert.ok(next.toDate().getTime() > Date.now());
});

test("a document_indexed watcher has no due row", emulated, async () => {
  const uid = `${UID}-docs`;
  const watcher = await createWatcher(uid, {
    name: "School letters",
    instruction: "When a file is ready, propose dates. Do not add them to the calendar.",
    triggerKind: "document_indexed",
    ceiling: "send_after_review",
  });
  const index = await scheduleIndex().doc(scheduleDocId(uid, watcher.id)).get();
  assert.equal(index.exists, false);
  assert.equal(watcher.triggerKind, "document_indexed");
});

test("a session-ended watcher has no due row", emulated, async () => {
  const uid = `${UID}-ended`;
  const watcher = await createWatcher(uid, {
    name: "After work",
    instruction: "When a piece of work ends, draft the follow-up",
    triggerKind: "session_ended",
    ceiling: "draft_only",
  });
  const index = await scheduleIndex().doc(scheduleDocId(uid, watcher.id)).get();
  assert.equal(index.exists, false);
});

test("pause clears the due flag and resume rewrites nextRunAt", emulated, async () => {
  const uid = `${UID}-pause`;
  const watcher = await createWatcher(uid, {
    name: "Hourly",
    instruction: "Every hour, draft a status",
    triggerKind: "schedule",
    intervalMinutes: 60,
    ceiling: "send_after_review",
  });
  const ref = scheduleIndex().doc(scheduleDocId(uid, watcher.id));
  const before = (await ref.get()).get("nextRunAt") as { toDate: () => Date };

  const paused = await setWatcherRunning(uid, watcher.id, false);
  assert.equal(paused?.running, false);
  assert.equal((await ref.get()).get("running"), false);

  await new Promise((r) => setTimeout(r, 20));
  const resumed = await setWatcherRunning(uid, watcher.id, true);
  assert.equal(resumed?.running, true);
  const after = (await ref.get()).get("nextRunAt") as { toDate: () => Date };
  assert.equal((await ref.get()).get("running"), true);
  assert.ok(after.toDate().getTime() >= before.toDate().getTime());
});

test("the index document never holds the instruction", emulated, async () => {
  const snap = await db.collection("watcherSchedule").limit(20).get();
  for (const doc of snap.docs) {
    assert.equal(doc.get("instruction"), undefined);
  }
});
