import "./test-env.js";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { DeckGraph } from "./document-design.js";
import {
  groupRetrievedDecks,
  loadDesignCatalog,
  pickCoherenceSlides,
} from "./document-design-rag.js";
import { flattenDeckGraph } from "./document-design.js";

const deck: DeckGraph = {
  id: "case-study",
  title: "Case study",
  source: "Case study.pptx",
  width: 13.333,
  height: 7.5,
  overall_deck_description: "Navy type, generous margins, photograph only on the cover.",
  slides: {
    "slide-01": {
      index: 0,
      prev: null,
      next: "slide-02",
      image: "case-study/slide-01.png",
      coordinates: [{ x: 0.8, y: 1.4, w: 6, h: 1.5, kind: "text", text: "Cover" }],
      description: {
        looksLike: "Title in empty sky.",
        title: "Cover",
        layout: "title-slide",
        background: { scope: "slide", kind: "photograph" },
        contentPlacement: "Title upper left.",
        images: [],
        boxes: [{ role: "title", text: "Cover", x: 0.8, y: 1.4, w: 6, h: 1.5 }],
      },
    },
    "slide-02": {
      index: 1,
      prev: "slide-01",
      next: "slide-03",
      image: "case-study/slide-02.png",
      coordinates: [],
      description: {
        looksLike: "Agenda.",
        title: "Agenda",
        layout: "title-and-body",
        background: { scope: "deck", kind: "solid", fill: "FFFFFF" },
        contentPlacement: "Title then bullets.",
        images: [],
        boxes: [],
      },
    },
    "slide-03": {
      index: 2,
      prev: "slide-02",
      next: null,
      image: "case-study/slide-03.png",
      coordinates: [],
      description: {
        looksLike: "Close.",
        title: "Close",
        layout: "title-only",
        background: { scope: "deck", kind: "solid" },
        contentPlacement: "Centered close.",
        images: [],
        boxes: [],
      },
    },
  },
};

test("a catalog JSON file is a deck graph, not a lone slide", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "slide-design-"));
  writeFileSync(path.join(dir, "case-study.json"), JSON.stringify(deck));
  const nodes = loadDesignCatalog(dir);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0]?.themeId, "case-study");
  assert.equal(nodes[0]?.deckDescription, deck.overall_deck_description);
  assert.equal(nodes[1]?.prevId, "case-study:slide-01");
  assert.equal(nodes[2]?.nextId, null);
});

test("grouping keeps one deck's slides in order with the overall description", () => {
  const nodes = flattenDeckGraph(deck);
  const grouped = groupRetrievedDecks(nodes);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.overall_deck_description, deck.overall_deck_description);
  assert.equal(grouped[0]?.width, 13.333);
  assert.equal(grouped[0]?.height, 7.5);
  assert.deepEqual(
    grouped[0]?.slides.map((s) => s.index),
    [0, 1, 2],
  );
});

test("coherence walk is previous, hit, next", () => {
  const nodes = flattenDeckGraph(deck);
  const hitSecond = [nodes[1]!, ...nodes.filter((n) => n.id !== nodes[1]!.id)];
  const picked = pickCoherenceSlides(hitSecond, 3);
  assert.deepEqual(
    picked.map((n) => n.slideIndex),
    [0, 1, 2],
  );
});
