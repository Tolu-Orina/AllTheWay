import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { actOnConfirmed } from "./act.js";

/**
 * The gap this closes: confirming a plan wrote a ledger row and nothing else.
 * "Yes" left the calendar empty, the draft unwritten, and the user with a
 * record of having agreed to something that never happened.
 */

test("a plan with no calls does nothing, and says so by doing nothing", async () => {
  const did = await actOnConfirmed({
    uid: "u1",
    sessionId: "s1",
    steps: [{ label: "Think about it" }, { label: "Read it back", connector: "", tool: "" }],
  });
  assert.deepEqual(did, [], "a step that changes nothing must not reach a connector");
});

test("only steps naming a connector and a tool are replayed", async () => {
  // Without a connector gateway configured the outcome is "skipped" rather than
  // an exception: a decision has already been recorded by this point, and
  // losing it because an environment lacks a connector would be worse.
  const did = await actOnConfirmed({
    uid: "u1",
    sessionId: "s1",
    steps: [
      { label: "Think" },
      { label: "Draft the reply", connector: "google_gmail", tool: "create_draft", arguments: {} },
    ],
  });
  assert.equal(did.length, 1, "only the actionable step is replayed");
  assert.equal(did[0].tool, "create_draft");
  assert.ok(["skipped", "failed", "refused", "done"].includes(did[0].did));
});

test("acting never throws, whatever the connector does", async () => {
  // The caller has already written the ledger row. An exception here would lose
  // the response that tells the user what happened.
  await assert.doesNotReject(
    actOnConfirmed({
      uid: "u1",
      sessionId: "s1",
      steps: [{ label: "x", connector: "nonexistent", tool: "nope", arguments: {} }],
    }),
  );
});
