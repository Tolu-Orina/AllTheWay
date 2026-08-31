import { equal } from "node:assert/strict";
import { test } from "node:test";

import { displayNameFromParticipant } from "./meet.js";

test("a Meet participant resource is not rendered as a person", () => {
  equal(displayNameFromParticipant({ name: "conferenceRecords/x/participants/1" }), undefined);
  equal(
    displayNameFromParticipant({
      signedinUser: { displayName: "Ada Cole", user: "users/123" },
    }),
    "Ada Cole",
  );
  equal(
    displayNameFromParticipant({
      signedinUser: { displayName: "conferenceRecords/x/participants/1" },
    }),
    undefined,
  );
});
