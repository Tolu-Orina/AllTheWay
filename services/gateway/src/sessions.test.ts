import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clipTitle,
  DEFAULT_TITLE,
  ensureSession,
  getSession,
  listSessions,
  touchSession,
  VOICE_TITLE,
} from "./repos/sessions.js";

/**
 * Session parent documents, against a real Firestore emulator.
 *
 * The product bug is a query behaviour, not a TypeScript one: a document that
 * only has subcollections is invisible to `orderBy("updatedAt")`. A mock store
 * would not reproduce that. Skip loudly when the emulator is down.
 */

const UID = `sessions-${Date.now()}`;

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
  console.warn(
    "\n  [sessions] Firestore emulator not reachable — skipping persistence tests.\n",
  );
}
const emulated = { skip: !live };

test("clipTitle collapses whitespace and caps at 80 characters", () => {
  assert.equal(clipTitle("  hello\nworld  "), "hello world");
  assert.equal(clipTitle("a".repeat(90)).length, 80);
  assert.equal(clipTitle("   "), "");
});

test("a first turn materialises a parent the list query can see", emulated, async () => {
  const id = "companion";
  await touchSession(UID, id, { utterance: "Draft the nav for Friday" });

  const listed = await listSessions(UID);
  const row = listed.find((s) => s.id === id);
  assert.ok(row, "the parent must appear in orderBy(updatedAt)");
  assert.equal(row.title, "Draft the nav for Friday");
  assert.equal(row.total, 1);

  const detail = await getSession(UID, id);
  assert.ok(detail);
  assert.equal(detail.scope, "");
  assert.equal(detail.companionNote, "");
  assert.equal(detail.correction, null);
  assert.deepEqual(detail.plan, []);
});

test("New work is retitled from the first utterance, then the title locks", emulated, async () => {
  const id = `new-${Date.now()}`;
  await ensureSession(UID, id, { title: DEFAULT_TITLE });

  const created = await getSession(UID, id);
  assert.equal(created?.title, DEFAULT_TITLE);
  assert.equal(created?.total, 1);

  await touchSession(UID, id, { utterance: "Put lunch on the calendar tomorrow" });
  assert.equal((await getSession(UID, id))?.title, "Put lunch on the calendar tomorrow");

  await touchSession(UID, id, { utterance: "Something else entirely" });
  assert.equal((await getSession(UID, id))?.title, "Put lunch on the calendar tomorrow");
});

test("a Voice default title is replaced by the first transcript line", emulated, async () => {
  const id = `voice-${Date.now()}`;
  await ensureSession(UID, id, { title: VOICE_TITLE });
  await touchSession(UID, id, { utterance: "Call the supplier about the invoice" });
  assert.equal((await getSession(UID, id))?.title, "Call the supplier about the invoice");
});

test("touching without a plan does not wipe one that was already stored", emulated, async () => {
  const id = `plan-${Date.now()}`;
  await touchSession(UID, id, {
    utterance: "Grant application",
    plan: [
      { label: "Pull last year's draft", done: true, action: "" },
      { label: "Rewrite the summary", done: false, action: "" },
    ],
    companionNote: "Reuse the 2025 phrasing.",
  });

  await touchSession(UID, id, { utterance: "and the budget too" });

  const detail = await getSession(UID, id);
  assert.equal(detail?.title, "Grant application");
  assert.equal(detail?.plan.length, 2);
  assert.equal(detail?.done, 1);
  assert.equal(detail?.total, 2);
  assert.equal(detail?.companionNote, "Reuse the 2025 phrasing.");
});

test("an empty plan still stores total 1 so the detail schema can parse", emulated, async () => {
  const id = `empty-${Date.now()}`;
  await ensureSession(UID, id);
  const detail = await getSession(UID, id);
  assert.ok(detail);
  assert.equal(detail.total, 1);
  assert.equal(detail.done, 0);
});
