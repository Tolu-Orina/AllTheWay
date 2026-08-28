import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { conceptId } from "./repos/concepts.js";

test("the same clause in the same document is one concept, not two", () => {
  const a = conceptId("doc-1", "Indemnity");
  const b = conceptId("doc-1", "  indemnity  ");
  const c = conceptId("doc-1", "Termination");
  const d = conceptId("doc-2", "Indemnity");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});
