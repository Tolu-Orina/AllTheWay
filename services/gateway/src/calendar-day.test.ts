import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { hatFromTitle, occurrencesInWindow, buildDayFromParts } from "./calendar-day.js";
import type { Rhythm } from "@alltheway/contracts";

test("church and school hats", () => {
  assert.equal(hatFromTitle("Pickup from school"), "home");
  assert.equal(hatFromTitle("Parish choir practice"), "church");
});

test("weekday school-run occurrences stay in the window", () => {
  const rhythm: Rhythm = {
    id: "r1",
    title: "School run",
    hat: "home",
    weekdays: [1, 2, 3, 4, 5],
    time: "08:10",
    timeZone: "Europe/London",
    personId: "",
    placeId: "",
  };
  const from = new Date("2026-08-28T07:00:00Z"); // Friday morning
  const until = new Date(from.getTime() + 12 * 60 * 60 * 1000);
  const found = occurrencesInWindow(rhythm, from, until);
  assert.ok(found.length >= 1);
  for (const at of found) {
    assert.ok(at >= from && at < until);
  }
});

test("a Meet hangoutLink is kept on the day row", () => {
  const day = buildDayFromParts(
    [],
    [],
    [],
    {
      status: "connected",
      events: [
        {
          id: "e1",
          title: "Standup",
          startsAt: "2099-01-01T10:00:00Z",
          meetUrl: "https://meet.google.com/abc-defg-hij",
        },
      ],
    },
    new Date("2099-01-01T08:00:00Z"),
  );
  assert.equal(day.hours[0]?.meetUrl, "https://meet.google.com/abc-defg-hij");
});
