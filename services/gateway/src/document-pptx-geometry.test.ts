import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { compileDeck } from "./office-slides.js";
import { extractPptxGeometry, inchesFromEmu } from "./document-pptx-geometry.js";
import { parseDeck } from "./office-ir.js";

test("EMU conversion is inches", () => {
  assert.equal(inchesFromEmu(914400), 1);
  assert.equal(inchesFromEmu(12_192_000), 13.333);
});

test("geometry comes from the PPTX, not a screenshot", async () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Geometry probe",
    slides: [
      {
        layout: "title-slide",
        title: "Hold the overspend",
        kicker: "Board",
        subtitle: "the Board",
      },
    ],
  });
  const compiled = await compileDeck(deck);
  const geometry = await extractPptxGeometry(compiled.body);
  assert.equal(geometry.slides.length, 1);
  const slide = geometry.slides[0]!;
  const title = slide.boxes.find((b) => (b.text ?? "").includes("Hold the overspend"));
  assert.ok(title, "title text is in the PPTX");
  assert.ok(title.x >= 0.5 && title.x <= 1.2);
  assert.ok(title.y >= 1.5 && title.y <= 2.4);
  assert.ok(title.w > 8);
  assert.ok(slide.layout);
  assert.ok(slide.boxes.length >= 1);
});
