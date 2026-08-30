import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDeck } from "./office-ir.js";
import { validateLayout } from "./document-validate.js";
import { GRID_IN, repairLayout, snapChrome } from "./document-repair.js";

test("repair pushes overlapping boxes apart until structure passes", () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Q4",
    slides: [
      {
        layout: "title-and-body",
        title: "Stacked",
        boxes: [
          { id: "t", role: "title", text: "Title on the body", x: 1, y: 1, w: 8, h: 3, fontSize: 32 },
          { id: "b", role: "body", text: "Body under the title", x: 1.2, y: 1.5, w: 8, h: 3, fontSize: 18 },
        ],
      },
    ],
  });
  const before = validateLayout(deck);
  assert.equal(before.ok, false);
  const { deck: next, changed } = repairLayout(deck, before.failures);
  assert.equal(changed, true);
  const after = validateLayout(next);
  assert.equal(after.ok, true);
  assert.equal(after.overlapCount, 0);
});

test("chrome snap aligns content-slide titles", () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Q4",
    slides: [
      {
        layout: "title-and-body",
        title: "First",
        boxes: [{ id: "t0", role: "title", text: "First", x: 0.7, y: 0.7, w: 11, h: 1, fontSize: 32 }],
      },
      {
        layout: "title-and-body",
        title: "Second",
        boxes: [{ id: "t1", role: "title", text: "Second", x: 1.1, y: 1.2, w: 11, h: 1, fontSize: 32 }],
      },
    ],
  });
  const snapped = snapChrome(deck);
  const y0 = snapped.slides[0]!.boxes[0]!.y;
  const y1 = snapped.slides[1]!.boxes[0]!.y;
  assert.equal(y0, y1);
  assert.ok(GRID_IN > 0.08 && GRID_IN < 0.09);
});
