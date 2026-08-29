import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REFERENCE_SPECS,
  loadReferencePages,
  referenceRoot,
  resetReferencePagesForTests,
} from "./document-references.js";
import { MAX_SUPPORTS } from "./office-ir.js";

test("the packaged archetypes are the critic’s visual bar", async () => {
  resetReferencePagesForTests();
  assert.equal(REFERENCE_SPECS.length, 8);
  assert.equal(MAX_SUPPORTS, 4);
  const root = referenceRoot();
  assert.ok(root, "services/document-cell/references must exist");
  const pages = await loadReferencePages();
  assert.equal(pages.length, 8);
  for (const page of pages) {
    assert.ok(page.bytes.length > 64);
    assert.equal(page.bytes[0], 0xff);
    assert.equal(page.bytes[1], 0xd8);
    assert.ok(page.role.length > 10);
  }
});
