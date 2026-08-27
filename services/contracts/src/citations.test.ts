import { ok } from "node:assert/strict";
import { test } from "node:test";

import { CitationSchema, GroundedDoneSchema, TurnEventSchema } from "./index.js";

/**
 * FR-D2 as a contract, not a prompt instruction.
 *
 * A fluent answer about an indemnity that cites nothing is the worst failure
 * this product can have. The live `done` event still allows empty citations —
 * ordinary chat is not grounded — so the control is this fixture: claiming
 * grounded with an empty list must not parse.
 */

const PASSAGE = {
  documentId: "d1",
  chunkId: "c1",
  page: 12,
  title: "Supply agreement",
  text: "The indemnity is capped at two million pounds.",
};

test("a grounded claim with empty citations fails", () => {
  const parsed = GroundedDoneSchema.safeParse({
    kind: "done",
    note: "The indemnity is capped at £2m.",
    grounded: true,
    citations: [],
  });
  ok(!parsed.success);
});

test("a grounded claim must carry the retrieved passage, not an id alone", () => {
  const parsed = GroundedDoneSchema.safeParse({
    kind: "done",
    note: "The indemnity is capped at £2m.",
    grounded: true,
    citations: [{ documentId: "d1", chunkId: "c1", page: 12, title: "Supply agreement" }],
  });
  ok(!parsed.success);
});

test("a grounded claim with the retrieved passage is a valid contract", () => {
  const parsed = GroundedDoneSchema.safeParse({
    kind: "done",
    note: "The indemnity is capped at £2m.",
    grounded: true,
    citations: [PASSAGE],
  });
  ok(parsed.success);
  ok(parsed.success && parsed.data.citations[0]?.text === PASSAGE.text);
});

test("a citation event is the passage already retrieved, with no uid", () => {
  const parsed = TurnEventSchema.safeParse({ kind: "citation", ...PASSAGE });
  ok(parsed.success);
  if (parsed.success && parsed.data.kind === "citation") {
    ok(!("uid" in parsed.data));
    ok(!("userId" in parsed.data));
    ok(parsed.data.text === PASSAGE.text);
  }
});

test("a citation without the passage text is not a citation", () => {
  ok(
    !CitationSchema.safeParse({
      documentId: "d1",
      chunkId: "c1",
      page: 12,
      title: "Supply agreement",
    }).success,
  );
});

test("an ordinary done event with no citations still parses", () => {
  // Chat that never opened a document. Empty citations here is honesty, not a
  // hole — GroundedDoneSchema is the fixture that closes the hole.
  ok(TurnEventSchema.safeParse({ kind: "done", note: "Done." }).success);
});
