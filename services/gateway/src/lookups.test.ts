import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { selectReadTools, startOfUtcDay } from "./lookups.js";

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

test("a meeting-today question selects the calendar, not meeting notes", () => {
  const calls = selectReadTools("Did I have any meeting today?");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["whats_on_my_calendar"],
  );
  assert.ok(
    typeof calls[0]?.args.time_min === "string" && String(calls[0].args.time_min).endsWith("Z"),
    "today includes this morning, so the window starts at the beginning of the day",
  );
});

test("any meetings today also selects the calendar", () => {
  assert.equal(selectReadTools("Do I have any meetings today?")[0]?.name, "whats_on_my_calendar");
});

test("later today stays upcoming and does not force a start-of-day window", () => {
  const calls = selectReadTools("What's on my calendar later today?");
  assert.equal(calls[0]?.name, "whats_on_my_calendar");
  assert.equal(calls[0]?.args.time_min, undefined);
});

test("a meeting-notes question selects recent meetings, not the calendar", () => {
  const calls = selectReadTools("What did we agree in the last meeting?");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["my_recent_meetings"],
  );
});

test("a reminder request selects the calendar", () => {
  assert.equal(selectReadTools("Remind me to call Sam at 3")[0]?.name, "whats_on_my_calendar");
});

test("an add-event request still reads the calendar first", () => {
  assert.equal(selectReadTools("Add an event for lunch tomorrow")[0]?.name, "whats_on_my_calendar");
});

test("sending notes to Drive selects Drive", () => {
  assert.equal(selectReadTools("Send these notes to Drive")[0]?.name, "find_in_my_drive");
});

test("a Gmail send or draft request selects the Gmail account status", () => {
  assert.equal(selectReadTools("Send this in Gmail")[0]?.name, "gmail_account");
  assert.equal(selectReadTools("Create a draft in Gmail")[0]?.name, "gmail_account");
});

test("drafting a wireframe is not a Gmail lookup", () => {
  assert.deepEqual(selectReadTools("Draft a nav wireframe for the desktop dashboard"), []);
});

test("blank input selects nothing", () => {
  assert.deepEqual(selectReadTools("   "), []);
});

test("startOfUtcDay is midnight Z", () => {
  assert.equal(startOfUtcDay(new Date("2026-08-28T15:51:00.000Z")), "2026-08-28T00:00:00Z");
});

test("a connector refusal is something the model can say, not empty events", async () => {
  const { toolResultFromConnector } = await import("./voice/tools.js");
  const refused = toolResultFromConnector(
    {
      refusal: "needs_consent",
      reason: "Your Google Calendar connection is no longer valid. Connect it again.",
      error: "Your Google Calendar connection is no longer valid. Connect it again.",
    },
    "",
  );
  assert.equal(
    refused.cannot,
    "Your Google Calendar connection is no longer valid. Connect it again.",
  );

  const events = toolResultFromConnector({ events: [{ id: "1", title: "Standup" }] }, "");
  assert.equal(events.cannot, undefined);
  assert.equal((events.events as { title: string }[])[0]?.title, "Standup");
});
