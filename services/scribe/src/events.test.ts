import { strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { readMeetEvent } from "./events.js";

const push = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") },
});

test("an ended-conference event yields a bare conference id", () => {
  const event = readMeetEvent(
    push({
      eventType: "google.workspace.meet.conference.v2.ended",
      conferenceRecord: { name: "conferenceRecords/abc123" },
    }),
  );

  strictEqual(event?.conferenceId, "abc123");
  strictEqual(event?.ended, true);
});

test("a started-conference event parses but is not an end", () => {
  // Parsed successfully and then ignored — which is different from failing,
  // and the difference decides whether Pub/Sub retries it.
  const event = readMeetEvent(
    push({
      eventType: "google.workspace.meet.conference.v2.started",
      conferenceRecord: { name: "conferenceRecords/abc123" },
    }),
  );

  strictEqual(event?.ended, false);
});

test("malformed deliveries return null rather than throwing", () => {
  // Each of these would otherwise become an infinite redelivery loop: Pub/Sub
  // retries anything not acknowledged, and none of them will parse next time.
  strictEqual(readMeetEvent(undefined), null);
  strictEqual(readMeetEvent({}), null);
  strictEqual(readMeetEvent({ message: {} }), null);
  strictEqual(readMeetEvent({ message: { data: "not-base64-json" } }), null);
});

test("an event naming no conference is not treated as one", () => {
  const event = readMeetEvent(push({ eventType: "google.workspace.meet.conference.v2.ended" }));
  strictEqual(event?.conferenceId, "");
});
