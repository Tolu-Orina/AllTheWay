import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyComposeFollowUp,
  bodyFromUtterance,
  composeFollowUpTurn,
  composeNeedsAddress,
  draftSummary,
} from "./compose-followup.js";
import type { PlanStep } from "@alltheway/contracts";

const draft = (args: Record<string, unknown>): PlanStep => ({
  label: "Draft to Blessing",
  done: false,
  action: "draft",
  connector: "google_gmail",
  tool: "create_draft",
  arguments: args,
});

test("a follow-up about the topic fills the body without starting a new draft", () => {
  const next = applyComposeFollowUp(
    [draft({ to: "Blessing", subject: "", body: "" })],
    "The message is about a QA session that we have tomorrow for the AllTheWay application",
  );
  assert.ok(next);
  assert.equal(next[0].arguments?.to, "Blessing");
  assert.match(String(next[0].arguments?.body), /QA session/);
  assert.match(String(next[0].arguments?.subject), /QA session/);
});

test("a spoken email address fills to and does not overwrite the body", () => {
  const next = applyComposeFollowUp(
    [draft({ to: "Blessing", subject: "QA", body: "Tomorrow's session." })],
    "blessing@example.com",
  );
  assert.ok(next);
  assert.equal(next[0].arguments?.to, "blessing@example.com");
  assert.equal(next[0].arguments?.body, "Tomorrow's session.");
});

test("send this draft is not merged into compose", () => {
  assert.equal(
    applyComposeFollowUp([draft({ to: "a@b.com", subject: "Hi", body: "Hi" })], "Send this draft"),
    null,
  );
});

test("a calendar request is not merged into a pending email", () => {
  assert.equal(
    applyComposeFollowUp(
      [draft({ to: "Blessing", subject: "", body: "" })],
      "Schedule lunch with Ana tomorrow",
    ),
    null,
  );
});

test("compose follow-up returns an updated confirm that still asks for the address", () => {
  const turn = composeFollowUpTurn(
    [draft({ to: "Blessing", subject: "", body: "" })],
    "The message is about tomorrow's QA session",
  );
  assert.ok(turn);
  assert.equal(turn.decision, "confirm");
  assert.match(turn.confirm.summary, /What's Blessing's email address/);
  assert.match(turn.confirm.summary, /QA/);
  assert.equal(turn.confirm.actions[0].tool, "create_draft");
});

test("a draft without @ still needs an address", () => {
  assert.equal(composeNeedsAddress([draft({ to: "Blessing" })]), true);
  assert.equal(composeNeedsAddress([draft({ to: "blessing@example.com" })]), false);
});

test("an email-only utterance is not treated as the body", () => {
  assert.equal(bodyFromUtterance("blessing@example.com"), "");
});

test("draft summary asks to save only when to and body are filled", () => {
  assert.match(
    draftSummary({ to: "ana@example.com", subject: "Hi", body: "See you." }),
    /Should I save it/,
  );
});
