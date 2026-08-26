import { strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { readMeetEvent, spaceIdFrom } from "./events.js";

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


test("a space id is normalised from either form it arrives in", () => {
  // Both appear depending on whether it comes as a CloudEvents source or a
  // resource name. A mismatch here would present as "nobody owns this meeting"
  // rather than as a parsing bug, which is the kind of thing that costs a day.
  strictEqual(spaceIdFrom("//meet.googleapis.com/spaces/abc123"), "abc123");
  strictEqual(spaceIdFrom("spaces/abc123"), "abc123");
  strictEqual(spaceIdFrom("abc123"), "abc123");
  strictEqual(spaceIdFrom(""), "");
});

test("the space is read from the CloudEvents attributes, not the payload", () => {
  const event = readMeetEvent({
    message: {
      data: Buffer.from(
        JSON.stringify({
          eventType: "google.workspace.meet.conference.v2.ended",
          conferenceRecord: { name: "conferenceRecords/rec1" },
        }),
      ).toString("base64"),
      attributes: { "ce-subject": "//meet.googleapis.com/spaces/space9" },
    },
  });

  strictEqual(event?.spaceId, "space9");
  strictEqual(event?.conferenceId, "rec1");
});

test("an event with no space yields no space rather than a wrong one", () => {
  // Guessing here would attribute someone's meeting to whoever happened to
  // match, which is the one mistake this system must never make.
  const event = readMeetEvent({
    message: {
      data: Buffer.from(
        JSON.stringify({ eventType: "google.workspace.meet.conference.v2.ended" }),
      ).toString("base64"),
    },
  });
  strictEqual(event?.spaceId, "");
});
