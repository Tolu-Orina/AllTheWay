import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDeck } from "./office-ir.js";
import { overlapArea, validateLayout } from "./document-validate.js";
import { promptHash, stillFromBytes } from "./document-images.js";
import { TINY_PNG } from "./document-png.js";

test("pairwise overlap on two text boxes is a hard fail", () => {
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
  const report = validateLayout(deck);
  assert.equal(report.ok, false);
  assert.ok(report.overlapCount >= 1);
  assert.ok(report.failures.some((v) => v.type === "overlap"));
  assert.ok(overlapArea(deck.slides[0]!.boxes[0]!, deck.slides[0]!.boxes[1]!) > 0.04);
});

test("a missing planned still is a hard fail when stills were required", () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Q4",
    slides: [
      {
        layout: "title-slide",
        title: "Q4",
        pictures: [
          { id: "cover", role: "picture", prompt: "war-room at dusk", x: 0, y: 3.55, w: 13.3, h: 3.95 },
        ],
      },
    ],
  });
  const report = validateLayout(deck, {}, undefined, true);
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((v) => v.type === "missing-image"));
});

test("a generated still satisfies the missing-image check", () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Q4",
    slides: [
      {
        layout: "title-slide",
        title: "Q4",
        pictures: [
          { id: "cover", role: "picture", prompt: "war-room at dusk", x: 0, y: 3.55, w: 13.3, h: 3.95 },
        ],
      },
    ],
  });
  const asset = stillFromBytes("war-room at dusk", TINY_PNG);
  const cache = new Map([[promptHash("war-room at dusk"), asset]]);
  const report = validateLayout(deck, { cover: TINY_PNG }, cache, true);
  assert.equal(report.failures.some((v) => v.type === "missing-image"), false);
});
