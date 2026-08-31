import "./test-env.js";
import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  BOT_DISPLAY,
  BOT_MEDIA,
  KNOCK_MS,
  botChatLine,
  botDisplayName,
  decideBotStart,
  knockOutcome,
} from "./meetings/bot-start.js";

const base = {
  disclosed: true as const,
  meetUrl: "https://meet.google.com/abc-defg-hij",
  tier: "max",
  vendorConfigured: false,
  firstName: "Tolu",
};

test("a bot start without disclosure is refused before anything else", () => {
  const result = decideBotStart({ ...base, disclosed: "true" });
  equal(result.ok, false);
  if (!result.ok) equal(result.code, "undisclosed");
});

test("a missing disclosure flag is refused", () => {
  const result = decideBotStart({ ...base, disclosed: undefined });
  equal(result.ok, false);
  if (!result.ok) equal(result.code, "undisclosed");
});

test("Zoom is refused in this slice", () => {
  const result = decideBotStart({ ...base, meetUrl: "https://zoom.us/j/1" });
  equal(result.ok, false);
  if (!result.ok) equal(result.code, "not_meet");
});

test("Team and Plus cannot send a bot", () => {
  const team = decideBotStart({ ...base, tier: "team" });
  equal(team.ok, false);
  if (!team.ok) equal(team.code, "metered");
});

test("Max still cannot join until finance signs a vendor", () => {
  const result = decideBotStart(base);
  equal(result.ok, false);
  if (!result.ok) equal(result.code, "vendor_pending");
});

test("a configured vendor on Max with disclosure is allowed to knock", () => {
  const result = decideBotStart({ ...base, vendorConfigured: true });
  equal(result.ok, true);
  if (result.ok) {
    equal(result.displayName, "AllTheWay notes · Tolu");
    equal(result.space, "abc-defg-hij");
  }
});

test("the waiting-room clock becomes not_admitted, not a recording failure", () => {
  equal(knockOutcome(0, 1_000, false), "knocking");
  equal(knockOutcome(0, KNOCK_MS, false), "not_admitted");
  equal(knockOutcome(0, 1_000, true), "admitted");
});

test("the display name is obviously AllTheWay, never a person spoof", () => {
  equal(botDisplayName(), BOT_DISPLAY);
  equal(botChatLine("Ada").includes("cannot speak"), true);
});

test("there is no unmute path", () => {
  equal(BOT_MEDIA.sendAudio, false);
  equal(BOT_MEDIA.microphone, "muted");
});
