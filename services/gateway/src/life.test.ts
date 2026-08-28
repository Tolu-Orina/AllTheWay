import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { hatFromTitle } from "./calendar-day.js";
import { extractCommitments, looksLikeLife } from "./routes/life.js";

test("hats from titles", () => {
  assert.equal(hatFromTitle("School pickup"), "home");
  assert.equal(hatFromTitle("Sunday choir"), "church");
  assert.equal(hatFromTitle("Standup"), "work");
});

test("extracts ISO dates from a flyer", () => {
  const found = extractCommitments("Football Thursday 2026-09-03 at the field\nChoir 2026-09-07 19:00");
  assert.ok(found.length >= 1);
  assert.ok(found.some((row) => row.startsAt !== null));
});

test("school flyers look like life", () => {
  assert.equal(looksLikeLife("School newsletter"), true);
  assert.equal(looksLikeLife("Q3 vendor contract"), false);
});
