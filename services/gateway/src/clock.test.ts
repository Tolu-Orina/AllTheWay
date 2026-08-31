import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clockPrompt,
  clockWire,
  isIanaTimeZone,
  resolveClock,
  startOfDayInZone,
  startOfYesterdayInZone,
} from "./clock.js";

test("IANA zones are accepted and junk is not", () => {
  assert.equal(isIanaTimeZone("Europe/London"), true);
  assert.equal(isIanaTimeZone("America/New_York"), true);
  assert.equal(isIanaTimeZone("UTC"), true);
  assert.equal(isIanaTimeZone(""), false);
  assert.equal(isIanaTimeZone("Not/AZone"), false);
  assert.equal(isIanaTimeZone("Europe/London/../etc"), false);
});

test("a London afternoon in August starts at 23:00 UTC the day before", () => {
  // 31 Aug 2026 is BST (UTC+1). Local midnight is 30 Aug 23:00Z.
  assert.equal(
    startOfDayInZone(new Date("2026-08-31T15:51:00.000Z"), "Europe/London"),
    "2026-08-30T23:00:00Z",
  );
});

test("UTC midnight is still midnight Z", () => {
  assert.equal(startOfDayInZone(new Date("2026-08-28T15:51:00.000Z"), "UTC"), "2026-08-28T00:00:00Z");
});

test("yesterday in London from a Monday afternoon is Sunday local midnight", () => {
  assert.equal(
    startOfYesterdayInZone(new Date("2026-08-31T15:51:00.000Z"), "Europe/London"),
    "2026-08-29T23:00:00Z",
  );
});

test("override wins both zones; device and calendar can differ", () => {
  const pinned = resolveClock({
    source: "override",
    deviceTimeZone: "Europe/Lisbon",
    calendarTimeZone: "Europe/London",
    overrideTimeZone: "Africa/Lagos",
  });
  assert.equal(pinned.source, "override");
  assert.equal(pinned.nowTimeZone, "Africa/Lagos");
  assert.equal(pinned.calendarTimeZone, "Africa/Lagos");
  assert.equal(pinned.differ, false);

  const travelled = resolveClock({
    source: "device",
    deviceTimeZone: "Europe/Lisbon",
    calendarTimeZone: "Europe/London",
    overrideTimeZone: "",
  });
  assert.equal(travelled.nowTimeZone, "Europe/Lisbon");
  assert.equal(travelled.calendarTimeZone, "Europe/London");
  assert.equal(travelled.differ, true);
  assert.equal(travelled.source, "device");
});

test("CLOCK names the source and never a map pin", () => {
  const text = clockPrompt(
    {
      nowTimeZone: "Europe/London",
      calendarTimeZone: "Europe/London",
      deviceTimeZone: "Europe/London",
      source: "device",
      differ: false,
    },
    new Date("2026-08-31T17:36:00.000Z"),
  );
  assert.match(text, /^CLOCK:/);
  assert.match(text, /from this device/);
  assert.match(text, /Europe\/London/);
  assert.match(text, /never a map pin/);
  assert.doesNotMatch(text, /latitude|GPS|geolocation/i);
});

test("when device and calendar disagree, CLOCK says so once", () => {
  const text = clockPrompt({
    nowTimeZone: "Europe/Lisbon",
    calendarTimeZone: "Europe/London",
    deviceTimeZone: "Europe/Lisbon",
    source: "device",
    differ: true,
  });
  assert.match(text, /calendar is Europe\/London/);
  assert.match(text, /where am I" use Europe\/Lisbon/);
});

test("the wire shape names timeZone, not nowTimeZone", () => {
  const wired = clockWire({
    nowTimeZone: "Africa/Lagos",
    calendarTimeZone: "Europe/London",
    deviceTimeZone: "Africa/Lagos",
    source: "device",
    differ: true,
  });
  assert.equal(wired.timeZone, "Africa/Lagos");
  assert.equal(wired.calendarTimeZone, "Europe/London");
  assert.equal(wired.differ, true);
  assert.equal("nowTimeZone" in wired, false);
});
