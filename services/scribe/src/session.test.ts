import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  DURATION_CAP_MINUTES,
  GAP_THRESHOLD_MS,
  MAX_RECONNECT_ATTEMPTS,
  capState,
  describeGap,
  isReportableGap,
  reconnectAfter,
  reportableGaps,
  utteranceId,
} from "./session.js";

/**
 * Tier 2 cannot be exercised until the preview admits this project, so these
 * cover the half that does not need it: the reconnect policy, the gap
 * arithmetic, the duration cap and the idempotency rule.
 *
 * Written as the ways a ninety-minute meeting goes wrong.
 */

// ---------------------------------------------------------------- reconnect

test("a dropped connection is retried", () => {
  const first = reconnectAfter(1, () => 1);
  strictEqual(first.retry, true);
  ok(first.delayMs > 0);
});

test("retries back off rather than hammering", () => {
  // No jitter, so the shape is visible.
  const delays = [1, 2, 3, 4].map((n) => reconnectAfter(n, () => 1).delayMs);
  for (let i = 1; i < delays.length; i += 1) {
    ok(delays[i]! > delays[i - 1]!, `attempt ${i + 1} did not back off`);
  }
});

test("backoff is capped", () => {
  // 2^5 of a quarter second is already eight seconds; doubling past that only
  // delays the honest answer that this is not coming back.
  strictEqual(reconnectAfter(5, () => 1).delayMs <= 8000, true);
});

test("retrying stops, and says so in terms of the meeting", () => {
  const decision = reconnectAfter(MAX_RECONNECT_ATTEMPTS + 1);
  strictEqual(decision.retry, false);

  // Not "WebSocket closed". The person reading this wants to know their notes
  // stopped, not which transport failed.
  ok(decision.reason.includes("meeting"), decision.reason);
  ok(!/socket|websocket|rtc/i.test(decision.reason), decision.reason);
});

test("jitter spreads simultaneous reconnects", () => {
  /**
   * The failure this prevents: one instance holding six meetings loses the
   * network for a moment and reconnects all six in the same millisecond,
   * producing a self-inflicted storm at the worst possible time.
   */
  const spread = new Set([0.1, 0.4, 0.9].map((r) => reconnectAfter(3, () => r).delayMs));
  strictEqual(spread.size, 3, "identical delays for different draws");
});

test("jitter never produces a negative or absurd delay", () => {
  for (const r of [0, 0.5, 0.999999]) {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      const { delayMs } = reconnectAfter(attempt, () => r);
      ok(delayMs >= 0 && delayMs <= 8000, `attempt ${attempt} gave ${delayMs}`);
    }
  }
});

// --------------------------------------------------------------------- gaps

test("a momentary blip is not reported as a gap", () => {
  // Labelling every renegotiation would bury the gaps that matter under noise,
  // which is its own kind of silence.
  strictEqual(isReportableGap("2026-08-27T14:02:00Z", "2026-08-27T14:02:00.300Z"), false);
});

test("a real gap is reported", () => {
  strictEqual(isReportableGap("2026-08-27T14:02:00Z", "2026-08-27T14:05:00Z"), true);
});

test("the threshold is where a sentence could go missing", () => {
  const from = "2026-08-27T14:02:00Z";
  const at = new Date(Date.parse(from) + GAP_THRESHOLD_MS).toISOString();
  strictEqual(isReportableGap(from, at), true);
});

test("a gap is described in clock time, in the notes", () => {
  const text = describeGap(
    { from: "2026-08-27T13:02:00Z", to: "2026-08-27T13:05:00Z" },
    "Europe/London",
  );

  // 13:02Z is 14:02 in British summer time — the time the person in the room
  // would recall, not the time on our server.
  ok(text.includes("14:02"), text);
  ok(text.includes("14:05"), text);

  // The point of the label is that something is missing. Saying only "no audio"
  // leaves the reader to assume nothing was said.
  ok(text.toLowerCase().includes("missing"), text);
});

test("unreadable timestamps do not become silent gaps", () => {
  // Failing closed here would be wrong in the dangerous direction: it would
  // report a gap that did not happen. Failing open is also wrong. What matters
  // is that it does not throw mid-meeting.
  strictEqual(isReportableGap("not-a-time", "2026-08-27T14:05:00Z"), false);
});

test("only reportable gaps survive the filter", () => {
  const gaps = [
    { from: "2026-08-27T14:00:00Z", to: "2026-08-27T14:00:00.200Z" },
    { from: "2026-08-27T14:02:00Z", to: "2026-08-27T14:05:00Z" },
  ];
  strictEqual(reportableGaps(gaps).length, 1);
});

// ------------------------------------------------------------ duration cap

test("a meeting inside the cap keeps running", () => {
  const started = "2026-08-27T09:00:00Z";
  const state = capState(started, new Date("2026-08-27T09:30:00Z"));
  strictEqual(state.stop, false);
  strictEqual(state.warn, false);
  strictEqual(state.minutesRemaining, DURATION_CAP_MINUTES - 30);
});

test("it warns while there is still time to act", () => {
  // A warning at the moment it stops is not a warning, it is a notification of
  // something already lost.
  const state = capState("2026-08-27T09:00:00Z", new Date("2026-08-27T10:27:00Z"));
  strictEqual(state.warn, true);
  strictEqual(state.stop, false);
});

test("it stops at the cap", () => {
  const state = capState("2026-08-27T09:00:00Z", new Date("2026-08-27T10:31:00Z"));
  strictEqual(state.stop, true);
  strictEqual(state.minutesRemaining, 0);
});

test("an explicit extension is honoured", () => {
  // Continuing past the cap is a decision someone made, with the cost shown.
  const state = capState(
    "2026-08-27T09:00:00Z",
    new Date("2026-08-27T10:31:00Z"),
    "2026-08-27T11:30:00Z",
  );
  strictEqual(state.stop, false);
});

test("an unreadable start time stops rather than records forever", () => {
  // The failure that bills indefinitely. A meeting whose start we cannot read
  // is a meeting we cannot bound, and unbounded is the one answer that is not
  // acceptable here.
  strictEqual(capState("nonsense", new Date()).stop, true);
  strictEqual(capState("2026-08-27T09:00:00Z", new Date(), "nonsense").stop, true);
});

// ------------------------------------------------------------- idempotency

test("the same utterance yields the same id", () => {
  /**
   * The whole point of Phase G's "notes do not duplicate".
   *
   * Meet replays entries after a reconnection. Without a derived id, every
   * replay became another copy of the same sentence — and the longer the
   * meeting, the more reconnections, the worse it got.
   */
  const a = utteranceId("2026-08-27T14:02:00Z", "Ada", "I'll send the contract.");
  const b = utteranceId("2026-08-27T14:02:00Z", "Ada", "I'll send the contract.");
  strictEqual(a, b);
});

test("whitespace differences do not create a second copy", () => {
  const a = utteranceId("2026-08-27T14:02:00Z", "Ada", "I'll send the contract.");
  const b = utteranceId("2026-08-27T14:02:00Z", "Ada", "  I'll send the contract.  ");
  strictEqual(a, b);
});

test("different speakers saying the same thing stay distinct", () => {
  const ada = utteranceId("2026-08-27T14:02:00Z", "Ada", "Agreed.");
  const bo = utteranceId("2026-08-27T14:02:00Z", "Bo", "Agreed.");
  ok(ada !== bo);
});

test("the same words at different times stay distinct", () => {
  const first = utteranceId("2026-08-27T14:02:00Z", "Ada", "Agreed.");
  const later = utteranceId("2026-08-27T14:40:00Z", "Ada", "Agreed.");
  ok(first !== later);
});

test("an id is usable as a Firestore document id", () => {
  const id = utteranceId("2026-08-27T14:02:00Z", "Ada", "I'll send the contract.");
  ok(id.length > 0 && id.length <= 1500);
  ok(!id.includes("/"), "a slash would silently create a subcollection path");
  ok(/^[0-9a-f]+$/.test(id));
});
