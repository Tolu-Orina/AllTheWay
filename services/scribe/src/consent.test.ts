import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./consent.js";

test("an unconfigured account does not get joined", () => {
  // The case that matters most. Joining a meeting is the most socially
  // expensive thing this product does — every participant sees a dialog — and
  // it must never happen because nobody got round to configuring it.
  const decision = decide(false, undefined);
  strictEqual(decision.allowed, false);
  ok(decision.reason.includes("not been switched on"));
});

test("switching it on is what permits a join", () => {
  strictEqual(decide(false, true).allowed, true);
});

test("a per-meeting opt-out beats the account being on", () => {
  // The common case: the standup is fine, the disciplinary conversation is not.
  // If the global switch could override this, people would leave it off
  // entirely and the feature would be worth nothing.
  const decision = decide(true, true);
  strictEqual(decision.allowed, false);
  ok(decision.reason.includes("stay out of this meeting"));
});

test("switched off and never switched on read differently", () => {
  // Same refusal, different fix. Collapsing them sends someone to look for a
  // setting they already turned off.
  ok(decide(false, false).reason.includes("switched off"));
  ok(decide(false, undefined).reason.includes("not been switched on"));
});

test("every refusal carries a reason a person can act on", () => {
  for (const [optedOut, global] of [
    [true, true],
    [false, false],
    [false, undefined],
  ] as const) {
    const decision = decide(optedOut, global);
    strictEqual(decision.allowed, false);
    ok(decision.reason.trim().length > 0, "a refusal with no reason is a mystery");
  }
});
