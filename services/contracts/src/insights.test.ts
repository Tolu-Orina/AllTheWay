import { ok, strictEqual, deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  INSIGHT_MARKS_MINUTES,
  insightDue,
  insightSchedule,
  nextInsightAt,
} from "./insights.js";

/**
 * The schedule exists for two reasons that pull the same way: a panel updating
 * constantly competes with the meeting, and a pass every minute for ninety
 * minutes is ninety reasoning calls over a growing window.
 */

test("the first look is early", () => {
  // The opening minutes establish what a meeting is about, and context arrives
  // faster then than it will again.
  strictEqual(nextInsightAt(0), 1);
});

test("the gaps widen as the meeting settles", () => {
  const gaps: number[] = [];
  let at = 0;
  for (let i = 0; i < 6; i += 1) {
    const next = nextInsightAt(at);
    gaps.push(next - at);
    at = next;
  }
  // Never narrows. An hour in, the ground has stopped shifting.
  for (let i = 1; i < gaps.length; i += 1) {
    ok(gaps[i]! >= gaps[i - 1]!, `gap ${i} narrowed: ${gaps.join(",")}`);
  }
});

test("it follows the agreed marks", () => {
  deepStrictEqual([...INSIGHT_MARKS_MINUTES], [1, 3, 5, 10, 15]);
  strictEqual(nextInsightAt(0), 1);
  strictEqual(nextInsightAt(1), 3);
  strictEqual(nextInsightAt(3), 5);
  strictEqual(nextInsightAt(5), 10);
  strictEqual(nextInsightAt(10), 15);
});

test("a long meeting keeps getting insights, just fewer", () => {
  // Settling to a steady interval rather than stopping: a two-hour meeting
  // should not go silent after the first quarter of an hour.
  strictEqual(nextInsightAt(15), 30);
  strictEqual(nextInsightAt(30), 45);
  strictEqual(nextInsightAt(80), 90);
});

test("a ninety-minute meeting costs ten passes, not ninety", () => {
  /**
   * The number that justifies the schedule. A fixed one-minute cadence would be
   * ninety reasoning calls over a window that only grows.
   */
  const schedule = insightSchedule(90);
  deepStrictEqual(schedule, [1, 3, 5, 10, 15, 30, 45, 60, 75, 90]);
  strictEqual(schedule.length, 10);
});

test("nothing runs before the first mark", () => {
  strictEqual(insightDue(0.5, null), false);
  strictEqual(insightDue(1, null), true);
});

test("a pass is not repeated until the next mark", () => {
  // Ran at 5; nothing due until 10.
  strictEqual(insightDue(6, 5), false);
  strictEqual(insightDue(9.9, 5), false);
  strictEqual(insightDue(10, 5), true);
});

test("a delayed pass does not trigger a burst to catch up", () => {
  /**
   * The failure this prevents: a pass is late — a slow model, a reconnect —
   * and the schedule then fires every mark it missed at once, which is both the
   * cost spike and the attention spike the whole design exists to avoid.
   *
   * Scheduling from *when the last pass actually ran* rather than from the
   * calendar of marks is what makes catching up impossible: a pass that ran at
   * minute 20 puts the next one at 30, not at 5, 10 and 15 in quick succession.
   */
  strictEqual(insightDue(21, 20), false);
  strictEqual(insightDue(29, 20), false);
  strictEqual(insightDue(30, 20), true);
});
