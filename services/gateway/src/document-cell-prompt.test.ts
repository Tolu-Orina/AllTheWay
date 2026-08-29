import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCUMENT_CELL_SYSTEM } from "./document-cell-prompt.js";

test("the document-cell system prompt encodes slide best practice", () => {
  const s = DOCUMENT_CELL_SYSTEM.toLowerCase();
  assert.match(DOCUMENT_CELL_SYSTEM, /You are the document-cell critic/);
  assert.match(s, /action titles/);
  assert.match(s, /titles test/);
  assert.match(s, /one message per slide/);
  assert.match(s, /takeaway/);
  assert.match(s, /at least three/);
  assert.match(s, /never invent x\/y/);
  assert.match(s, /never a generated picture of a graph/);
  assert.match(s, /do not talk to the person/);
  assert.match(s, /score >= 95/);
  assert.match(s, /assertion/);
  assert.match(s, /18pt/);
  assert.match(s, /0\.5in/);
  assert.match(s, /more than four bullets/);
  assert.match(s, /libreoffice/);
});
