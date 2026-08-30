import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clipTitle,
  DEFAULT_TITLE,
  ensureSession,
  getSession,
  listSessions,
  sessionSurface,
  touchSession,
  appendThread,
  conversationContext,
  setCorrection,
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

test("the legacy companion id is a companion chat, not work", () => {
  assert.equal(sessionSurface("companion"), "companion");
  assert.equal(sessionSurface("abc-uuid"), "work");
  assert.equal(sessionSurface("abc-uuid", { surface: "companion" }), "companion");
});

test("conversationContext keeps role, text, and options for the planner", () => {
  const lines = conversationContext([
    { role: "user", text: "I want to generate an image.", at: "2026-01-01T00:00:00.000Z" },
    {
      role: "agent",
      text: "What kind of image?",
      at: "2026-01-01T00:00:01.000Z",
      options: ["Anime character illustration", "A landscape"],
    },
  ]);
  assert.equal(lines[0], "user: I want to generate an image.");
  assert.equal(lines[1], "agent: What kind of image?");
  assert.equal(lines[2], "options: Anime character illustration | A landscape");
});

test("companion chats do not appear in the work list", emulated, async () => {
  const workId = `work-${Date.now()}`;
  const chatId = `chat-${Date.now()}`;
  await ensureSession(UID, workId, { title: DEFAULT_TITLE, surface: "work" });
  await ensureSession(UID, chatId, { title: "New chat", surface: "companion" });
  await touchSession(UID, workId, { utterance: "Draft the nav" });
  await touchSession(UID, chatId, { utterance: "What is on today" });

  const work = await listSessions(UID, "work");
  const chats = await listSessions(UID, "companion");
  assert.ok(work.some((s) => s.id === workId));
  assert.ok(!work.some((s) => s.id === chatId));
  assert.ok(chats.some((s) => s.id === chatId));
  assert.ok(!chats.some((s) => s.id === workId));
});

test("a first turn materialises a parent the list query can see", emulated, async () => {
  const id = "companion";
  await touchSession(UID, id, { utterance: "Draft the nav for Friday" });

  const listed = await listSessions(UID, "companion");
  const row = listed.find((s) => s.id === id);
  assert.ok(row, "the parent must appear in the companion list");
  assert.equal(row.title, "Draft the nav for Friday");
  assert.equal(row.total, 1);
  assert.equal(row.surface, "companion");

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

test("a stored plan keeps the call the person was shown", emulated, async () => {
  const id = `call-${Date.now()}`;
  await touchSession(UID, id, {
    utterance: "Lunch with Ana tomorrow",
    plan: [
      {
        label: "Put lunch on the calendar",
        done: false,
        action: "create_task",
        connector: "google_calendar",
        tool: "create_event",
        arguments: { title: "Lunch with Ana" },
      },
    ],
  });

  const detail = await getSession(UID, id);
  assert.equal(detail?.plan[0]?.connector, "google_calendar");
  assert.equal(detail?.plan[0]?.tool, "create_event");
  assert.equal((detail?.plan[0]?.arguments as { title?: string })?.title, "Lunch with Ana");
});

test("an empty plan still stores total 1 so the detail schema can parse", emulated, async () => {
  const id = `empty-${Date.now()}`;
  await ensureSession(UID, id);
  const detail = await getSession(UID, id);
  assert.ok(detail);
  assert.equal(detail.total, 1);
  assert.equal(detail.done, 0);
  assert.deepEqual(detail.thread, []);
});

test("appended thread messages survive a later touch", emulated, async () => {
  const id = `thread-${Date.now()}`;
  await touchSession(UID, id, { utterance: "What's on today" });
  await appendThread(UID, id, [
    {
      role: "user",
      text: "What's on today",
      at: new Date().toISOString(),
    },
    {
      role: "agent",
      text: "You have standup at 10.",
      at: new Date().toISOString(),
      phase: "done",
    },
  ]);

  await touchSession(UID, id, { utterance: "and tomorrow" });

  const detail = await getSession(UID, id);
  assert.equal(detail?.thread.length, 2);
  assert.equal(detail?.thread[0]?.role, "user");
  assert.equal(detail?.thread[1]?.text, "You have standup at 10.");
});

test("a correction lands on the session and survives a later touch", emulated, async () => {
  const id = `corr-${Date.now()}`;
  await touchSession(UID, id, { utterance: "Draft the nav" });
  assert.equal(await setCorrection(UID, id, { was: "six items", now: "four items" }), "ok");
  assert.equal(await setCorrection(UID, "no-such-session", { was: "a", now: "b" }), "missing");
  assert.equal(await setCorrection(UID, id, { was: "same", now: "same" }), "noop");

  await touchSession(UID, id, { utterance: "and the footer" });
  const detail = await getSession(UID, id);
  assert.equal(detail?.correction?.was, "six items");
  assert.equal(detail?.correction?.now, "four items");
});
