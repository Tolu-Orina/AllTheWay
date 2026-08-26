import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { isCommitment, proposalSummary, proposals, speakerLabel, toNotes } from "./notes.js";

test("a plain commitment is detected", () => {
  ok(isCommitment("I'll send the contract by Friday."));
  ok(isCommitment("I will get you the numbers tomorrow."));
});

test("the phrases that sound like commitments and are not", () => {
  // These appear in every meeting. A product that proposes a task for each one
  // teaches people to dismiss proposals without reading them, which costs more
  // than the commitments it catches.
  for (const said of [
    "I'll think about it.",
    "I'll be honest, that's difficult.",
    "Let me know what you decide.",
    "I'll probably look at it next week.",
  ]) {
    strictEqual(isCommitment(said), false, `wrongly flagged: ${said}`);
  }
});

test("an unattributed speaker is labelled, never guessed", () => {
  // Tier 2 receives three audio streams for a meeting that may hold twelve
  // people. A confident wrong name is worse than no name.
  strictEqual(speakerLabel({ at: "t", text: "x" }), "Unattributed");
  strictEqual(speakerLabel({ at: "t", speaker: "  ", text: "x" }), "Unattributed");
  strictEqual(speakerLabel({ at: "t", speaker: "Ada", text: "x" }), "Ada");
});

test("empty utterances do not become notes", () => {
  const notes = toNotes([
    { at: "t1", text: "   " },
    { at: "t2", text: "Real content." },
  ]);
  strictEqual(notes.length, 1);
});

test("a commitment is a proposal and is never confirmed at creation", () => {
  // FR-C2, structurally: there is no code path in this module that produces a
  // confirmed commitment, and `confirmed` is typed as the literal false.
  const found = proposals(toNotes([{ at: "t", speaker: "Ada", text: "I'll send the contract." }]));

  strictEqual(found.length, 1);
  strictEqual(found[0]!.confirmed, false);
});

test("nothing in a proposal reads as an action already taken", () => {
  const [proposal] = proposals(
    toNotes([{ at: "t", speaker: "Ada", text: "I'll send the contract." }]),
  );
  const summary = proposalSummary(proposal!);

  // The wording is the safety property. "Sent the contract" in a meeting
  // summary is a lie the user will act on.
  ok(summary.includes("may have committed"));
  ok(summary.includes("Nothing has been done about it."));
  for (const done of [" sent ", " emailed ", " scheduled ", " completed "]) {
    ok(!summary.toLowerCase().includes(done), `reads as done: ${done}`);
  }
});

test("an unattributed commitment does not invent a person", () => {
  const [proposal] = proposals(toNotes([{ at: "t", text: "I'll send the contract." }]));
  ok(proposalSummary(proposal!).startsWith("Someone"));
});

test("ordinary discussion produces notes but no proposals", () => {
  const notes = toNotes([
    { at: "t1", speaker: "Ada", text: "The margin was twelve percent last quarter." },
    { at: "t2", speaker: "Bo", text: "That matches what finance said." },
  ]);
  strictEqual(notes.length, 2);
  strictEqual(proposals(notes).length, 0);
});
