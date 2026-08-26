import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { refusalText, resolveTier, tierExplanation, type Attempt } from "./tier.js";

const connects: Attempt = { connect: async () => {} };
const refuses = (why: unknown): Attempt => ({
  connect: async () => {
    throw why;
  },
});

test("Tier 2 is attempted first, every time", async () => {
  const order: string[] = [];
  await resolveTier(
    { connect: async () => void order.push("tier2") },
    { connect: async () => void order.push("tier1") },
  );
  // The instruction is "Tier 2 by default". If Tier 1 were ever tried first as
  // an optimisation, the default would silently become Tier 1 on every meeting
  // and nobody would see it happen.
  deepStrictEqual(order, ["tier2"]);
});

test("a connected Tier 2 records no reason", async () => {
  const outcome = await resolveTier(connects, connects);
  strictEqual(outcome.tier, 2);
  strictEqual(outcome.reason, "");
});

test("a refused Tier 2 falls to Tier 1 and keeps the refusal verbatim", async () => {
  const outcome = await resolveTier(
    refuses(new Error("Participant not enrolled in the Developer Preview Program.")),
    connects,
  );

  strictEqual(outcome.tier, 1);
  // Verbatim, because the refusal set belongs to a preview programme we do not
  // control and this string is the only way to learn which ones happen.
  strictEqual(outcome.reason, "Participant not enrolled in the Developer Preview Program.");
});

test("both tiers failing is recorded rather than thrown", async () => {
  // The user is in a meeting. There is nothing they can do about an exception,
  // and a crashed scribe loses the meeting record along with the notes.
  const outcome = await resolveTier(
    refuses(new Error("Meeting is encrypted.")),
    refuses(new Error("No transcript was produced.")),
  );

  strictEqual(outcome.tier, 0);
  ok(outcome.reason.includes("Meeting is encrypted."));
  // Both causes survive. With only the second, nobody learns that Tier 2 was
  // refused for an unrelated reason.
  ok(outcome.reason.includes("No transcript was produced."));
});

test("a refusal that is not an Error still produces a reason", async () => {
  // WebRTC and fetch reject with all sorts of things. A refusal stored as
  // "[object Object]" is a refusal nobody can act on.
  const outcome = await resolveTier(refuses({ code: 403 }), connects);
  strictEqual(outcome.tier, 1);
  ok(outcome.reason.length > 0);
  ok(!outcome.reason.includes("[object"));
});

test("an empty refusal message is reported as a missing reason", () => {
  // "" would render as a blank explanation reading like there was no problem.
  ok(refusalText(new Error("   ")).includes("without a reason"));
});

test("a refusal cannot inject newlines into a log or a trace", () => {
  const forged = refusalText(new Error("denied\n2026-01-01 INFO everything is fine"));
  ok(!forged.includes("\n"));
});

test("a very long refusal is bounded", () => {
  const text = refusalText(new Error("x".repeat(5000)));
  ok(text.length <= 501, `got ${text.length}`);
});

test("the explanation never implies the agent spoke", () => {
  // FR-C4. The Media API is receive-only; a user who believes otherwise will
  // eventually rely on it to say something in a meeting.
  const live = tierExplanation({ tier: 2, reason: "" }).toLowerCase();
  for (const claim of ["said", "spoke", "replied", "asked", "told", "answered"]) {
    ok(!live.includes(claim), `explanation implies speech: ${claim}`);
  }
});

test("a Tier 1 explanation says why the live notes are missing", () => {
  const text = tierExplanation({ tier: 1, reason: "Meeting is watermarked." });
  ok(text.includes("Meeting is watermarked."));
});
