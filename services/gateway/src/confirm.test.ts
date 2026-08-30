import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { isSpokenNo, isSpokenYes, normalizeSpoken } from "./voice/confirm.js";
import {
  bindInviteEventId,
  eventIdFromConnectorTask,
  isPlaceholderEventId,
  prepareCallArgs,
} from "./act.js";

test("yeah go ahead and yes please are a yes, with ordinary speech punctuation", () => {
  assert.equal(isSpokenYes("Yeah, go ahead."), true);
  assert.equal(isSpokenYes("Yes, please."), true);
  assert.equal(isSpokenYes("yes please"), true);
  assert.equal(isSpokenYes("Yes"), true);
  assert.equal(isSpokenYes("go ahead"), true);
  assert.equal(isSpokenYes("  OK  "), true);
});

test("a yes that also changes the plan is not confirmation", () => {
  assert.equal(isSpokenYes("yes, but make it 11"), false);
  assert.equal(isSpokenYes("yes, invite Maya too"), false);
  assert.equal(isSpokenYes("Are you done creating the meeting?"), false);
  assert.equal(isSpokenYes("tomorrow 10 a.m. UK time"), false);
});

test("no and stop are a decline", () => {
  assert.equal(isSpokenNo("No, stop"), true);
  assert.equal(isSpokenNo("No thanks"), true);
  assert.equal(isSpokenNo("yes please"), false);
});

test("normalizeSpoken strips commas so Yeah, go ahead matches", () => {
  assert.equal(normalizeSpoken("Yeah, go ahead."), "yeah go ahead");
});

test("a create_event result yields an id the next invite can use", () => {
  assert.equal(
    eventIdFromConnectorTask({
      artifacts: [{ parts: [{ data: { data: { id: "evt-99", title: "QA" } } }] }],
    }),
    "evt-99",
  );
  assert.equal(
    eventIdFromConnectorTask({ data: { created: { id: "evt-1", title: "Lunch" } } }),
    "evt-1",
  );
});

test("send_invite with a placeholder event_id takes the id create_event just returned", () => {
  assert.equal(isPlaceholderEventId(""), true);
  assert.equal(isPlaceholderEventId("new"), true);
  assert.equal(isPlaceholderEventId("abc123real"), false);
  assert.equal(bindInviteEventId({ event_id: "", email: "a@x.com" }, "evt-9").event_id, "evt-9");
  assert.equal(bindInviteEventId({ event_id: "kept", email: "a@x.com" }, "evt-9").event_id, "kept");
});

test("attendees can arrive as an array and still go to the connector as one string", () => {
  const args = prepareCallArgs(
    {
      tool: "create_event",
      arguments: {
        title: "QA",
        starts_at: "2026-08-31T10:00:00+01:00",
        attendees: ["a@x.com", "b@x.com"],
      },
    },
    "",
  );
  assert.equal(args.attendees, "a@x.com,b@x.com");
});
