import "./test-env.js";
import { equal, deepEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  captionMatchesUtterance,
  diarizeMix,
  isPlatformDisplayName,
  meetSpaceFromUrl,
  overlayNames,
  speakerFromCaptions,
} from "./meetings/speaker.js";

test("a caption speaker attaches only when the text is the same utterance", () => {
  const name = speakerFromCaptions("I'll send the contract today", [
    { speaker: "Ada Cole", text: "I'll send the contract today" },
  ]);
  equal(name, "Ada Cole");
});

test("a weak overlap does not steal a name", () => {
  const name = speakerFromCaptions("yes", [{ speaker: "Ada Cole", text: "yes we should" }]);
  equal(name, undefined);
});

test("a Meet participant resource name is not a display name", () => {
  equal(isPlatformDisplayName("conferenceRecords/abc/participants/xyz"), false);
  equal(isPlatformDisplayName("Ada Cole"), true);
  equal(isPlatformDisplayName(""), false);
});

test("overlay fills Unattributed from REST display names, never resource paths", () => {
  const next = overlayNames(
    [
      { at: "t1", text: "I'll send the contract today", speakerLabel: "Unattributed" },
      { at: "t2", text: "That works", speakerLabel: "Bo" },
    ],
    [
      { text: "I'll send the contract today", speaker: "conferenceRecords/x/participants/1" },
      { text: "I'll send the contract today", speaker: "Ada Cole" },
      { text: "That works", speaker: "Someone Else" },
    ],
  );
  equal(next[0]?.speakerLabel, "Ada Cole");
  equal(next[1]?.speakerLabel, "Bo");
});

test("a Meet space code is taken from the tab URL, not from landing or lookup", () => {
  equal(meetSpaceFromUrl("https://meet.google.com/abc-defg-hij"), "abc-defg-hij");
  equal(meetSpaceFromUrl("https://meet.google.com/landing"), undefined);
  equal(meetSpaceFromUrl("https://zoom.us/j/123"), undefined);
});

test("batch diarize refuses without stored audio rather than inventing Speaker 1", () => {
  deepEqual(diarizeMix(null), { ok: false, reason: "no_stored_audio" });
  equal(captionMatchesUtterance("", "hello"), false);
});
