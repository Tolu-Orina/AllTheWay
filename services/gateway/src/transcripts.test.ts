import "./test-env.js";
import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  forgetTranscript,
  keepsTranscripts,
  readTranscript,
  recordLine,
  setKeepTranscripts,
} from "./repos/transcripts.js";

/**
 * Voice was ephemeral. Keeping it is a change in what this product remembers
 * about a person, so these are written as the ways that goes wrong — recording
 * someone who never asked, and failing to forget when they ask.
 */

const UID = `voice-${Date.now()}`;
const SESSION = "session-1";

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
if (!live) console.warn("\n  [transcripts] Firestore emulator not reachable — skipping.\n");
const emulated = { skip: !live };

const line = (text: string, side: "user" | "model" = "user") => ({
  side,
  text,
  at: new Date().toISOString(),
});

test("nothing is kept until it is switched on", emulated, async () => {
  // The default that matters. A voice conversation has always been ephemeral,
  // and someone who never opted in must not discover a record of it later.
  strictEqual(await keepsTranscripts(UID), false);
  strictEqual(await recordLine(UID, SESSION, line("This should not be stored.")), false);
  strictEqual((await readTranscript(UID, SESSION)).length, 0);
});

test("switching it on starts keeping lines", emulated, async () => {
  await setKeepTranscripts(UID, true);
  strictEqual(await recordLine(UID, SESSION, line("Kept from here.")), true);

  const lines = await readTranscript(UID, SESSION);
  ok(lines.some((l) => l.text === "Kept from here."));
});

test("switching it off stops immediately", emulated, async () => {
  /**
   * The switch has to mean what it appears to mean. Reading the setting once
   * per session and caching it would keep recording someone who turned it off
   * halfway through a conversation — precisely when they most meant it.
   */
  await setKeepTranscripts(UID, false);
  strictEqual(await recordLine(UID, SESSION, line("Said after switching off.")), false);

  const lines = await readTranscript(UID, SESSION);
  strictEqual(lines.some((l) => l.text === "Said after switching off."), false);
});

test("a refined line does not become three copies", emulated, async () => {
  /**
   * The Live API emits a transcript repeatedly as it sharpens it. Only finished
   * lines are recorded, but an identical finished line redelivered must also
   * collapse — otherwise a reconnect doubles the record.
   */
  await setKeepTranscripts(UID, true);
  const same = line("I'll send the contract on Friday.");

  await recordLine(UID, SESSION, same);
  await recordLine(UID, SESSION, same);
  await recordLine(UID, SESSION, same);

  const matching = (await readTranscript(UID, SESSION)).filter(
    (l) => l.text === "I'll send the contract on Friday.",
  );
  strictEqual(matching.length, 1);
});

test("both sides of the conversation are kept", emulated, async () => {
  // An audit of what was agreed needs the answer as well as the question.
  await setKeepTranscripts(UID, true);
  await recordLine(UID, SESSION, line("What did we decide about pricing?", "user"));
  await recordLine(UID, SESSION, line("You agreed to hold at twelve percent.", "model"));

  const lines = await readTranscript(UID, SESSION);
  ok(lines.some((l) => l.side === "user"));
  ok(lines.some((l) => l.side === "model"));
});

test("empty lines are not stored", emulated, async () => {
  await setKeepTranscripts(UID, true);
  strictEqual(await recordLine(UID, SESSION, line("   ")), false);
});

test("a transcript can be forgotten", emulated, async () => {
  /**
   * Switching recording off stops new lines. It does not remove what is already
   * there, and a record kept after someone asked for it to go is worse than
   * never having offered the feature.
   */
  await setKeepTranscripts(UID, true);
  await recordLine(UID, SESSION, line("Forget this."));
  ok((await readTranscript(UID, SESSION)).length > 0);

  const removed = await forgetTranscript(UID, SESSION);
  ok(removed > 0);
  strictEqual((await readTranscript(UID, SESSION)).length, 0);
});

test("forgetting an empty transcript is not an error", emulated, async () => {
  strictEqual(await forgetTranscript(UID, "no-such-session"), 0);
});

test("one user's transcript is not another's", emulated, async () => {
  // Path-scoped like everything else. Asserted rather than assumed, because
  // this collection is new and the rule is the one that must never bend.
  const other = `voice-other-${Date.now()}`;
  await setKeepTranscripts(other, true);
  await recordLine(other, SESSION, line("Belongs to someone else."));

  const mine = await readTranscript(UID, SESSION);
  strictEqual(mine.some((l) => l.text === "Belongs to someone else."), false);
});
