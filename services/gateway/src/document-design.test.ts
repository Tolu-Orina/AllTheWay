import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boxDistance,
  cosine,
  descriptionToText,
  expandTheme,
  flattenDeckGraph,
  nearestDesigns,
  slideKey,
  validateDescription,
  type DeckGraph,
  type SlideDesignNode,
} from "./document-design.js";
import { normalizeDescription } from "./document-design-describe.js";

const description = {
  looksLike: "Black title in empty sky, photograph on the lower half.",
  title: "Consulting Proposal",
  layout: "title-slide" as const,
  background: { scope: "slide" as const, kind: "photograph" as const },
  contentPlacement: "Title upper left; photo bleeds the lower half.",
  images: [{ kind: "picture" as const, what: "landscape", x: 0, y: 3.55, w: 13.3, h: 3.95 }],
  boxes: [{ role: "title", text: "Consulting Proposal", x: 0.8, y: 1.45, w: 5.35, h: 1.82, fontSize: 48 }],
};

const cover: SlideDesignNode = {
  id: "consulting-proposal:slide-01",
  themeId: "consulting-proposal",
  themeTitle: "Consulting proposal",
  slideIndex: 0,
  prevId: null,
  nextId: "consulting-proposal:slide-02",
  layout: "title-slide",
  description,
  descriptionText: "Cover",
  deckDescription: "A teal-and-photo consulting theme.",
  width: 13.333,
  height: 7.5,
  geometry: [],
};

const agenda: SlideDesignNode = {
  ...cover,
  id: "consulting-proposal:slide-02",
  slideIndex: 1,
  prevId: "consulting-proposal:slide-01",
  nextId: null,
  layout: "title-and-body",
  descriptionText: "Agenda teal full bleed",
};

test("flattening a deck graph keeps slide order and the overall description", () => {
  const deck: DeckGraph = {
    id: "consulting-proposal",
    title: "Consulting proposal",
    source: "Consulting proposal.pptx",
    width: 13.333,
    height: 7.5,
    overall_deck_description: "A teal-and-photo consulting theme.",
    slides: {
      "slide-01": {
        index: 0,
        prev: null,
        next: "slide-02",
        image: "consulting-proposal/slide-01.png",
        coordinates: [],
        description,
      },
      "slide-02": {
        index: 1,
        prev: "slide-01",
        next: null,
        image: "consulting-proposal/slide-02.png",
        coordinates: [],
        description: { ...description, layout: "title-and-body", title: "Agenda" },
      },
    },
  };
  assert.equal(slideKey(0), "slide-01");
  const nodes = flattenDeckGraph(deck);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]?.id, "consulting-proposal:slide-01");
  assert.equal(nodes[0]?.nextId, "consulting-proposal:slide-02");
  assert.equal(nodes[0]?.deckDescription, "A teal-and-photo consulting theme.");
  assert.equal(nodes[0]?.width, 13.333);
  assert.equal(nodes[1]?.prevId, "consulting-proposal:slide-01");
  assert.match(descriptionToText(description), /Consulting Proposal/);
});

test("a theme hit expands to sibling slides in order", () => {
  const expanded = expandTheme(cover, [agenda, cover]);
  assert.equal(expanded[0]?.id, "consulting-proposal:slide-01");
  assert.equal(expanded[1]?.id, "consulting-proposal:slide-02");
  assert.equal(expanded[1]?.prevId, "consulting-proposal:slide-01");
});

test("cosine ranks a matching embedding first", () => {
  const a = { ...cover, embedding: [1, 0, 0] };
  const b = { ...agenda, embedding: [0, 1, 0] };
  const hits = nearestDesigns([1, 0, 0], [b, a], 1);
  assert.equal(hits[0]?.id, "consulting-proposal:slide-01");
  assert.ok(cosine([1, 0], [1, 0]) > cosine([1, 0], [0, 1]));
});

test("a description is valid when its boxes sit on the extracted geometry", () => {
  const geometry = [
    { x: 0.8, y: 1.45, w: 5.35, h: 1.82, kind: "text" as const, text: "Consulting Proposal", placeholder: "ctrTitle" },
  ];
  const desc = normalizeDescription(
    {
      looksLike: "Title in sky",
      title: "Consulting Proposal",
      layout: "title-slide",
      boxes: [{ role: "title", text: "Consulting Proposal", x: 0.8, y: 1.45, w: 5.35, h: 1.82 }],
    },
    { index: 0, layout: "title-slide", boxes: geometry },
  );
  const result = validateDescription(geometry, desc);
  assert.equal(result.ok, true);
  assert.ok(descriptionToText(desc).includes("Consulting Proposal"));
  assert.ok(boxDistance(geometry[0]!, desc.boxes[0]!) < 0.05);
});
