import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { selectReadTools } from "./lookups.js";

test("a calendar question selects the calendar read and nothing else", () => {
  const calls = selectReadTools("What's on my calendar later today?");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["whats_on_my_calendar"],
  );
});

test("a Drive question selects Drive", () => {
  const calls = selectReadTools("Find the Q3 budget in Drive");
  assert.equal(calls[0]?.name, "find_in_my_drive");
});

test("a waiting/digest question selects the digest read", () => {
  const calls = selectReadTools("Anything waiting on me?");
  assert.equal(calls[0]?.name, "whats_waiting_for_me");
});

test("a meeting-notes question selects recent meetings, not the calendar", () => {
  const calls = selectReadTools("What did we agree in the last meeting?");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["my_recent_meetings"],
  );
});

test("a planning request that is not a lookup selects nothing", () => {
  assert.deepEqual(selectReadTools("Draft a nav wireframe for the desktop dashboard"), []);
});

test("blank input selects nothing", () => {
  assert.deepEqual(selectReadTools("   "), []);
});
