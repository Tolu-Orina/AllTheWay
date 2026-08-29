import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CRITIQUE_ROUNDS,
  MAX_SLIDES,
  MAX_SUPPORTS,
  MIN_IMAGES,
  VISUAL_PASS_SCORE,
  applyDeckPatch,
  ensureDeckImages,
  imageSlots,
  parseDeck,
} from "./office-ir.js";
import { compileWorkFile, runDocumentQuality } from "./document-quality.js";
import { isLibreOfficeAvailable, renderPptxPages } from "./document-libreoffice.js";
import { rasterDeck } from "./document-raster.js";
import { compileDeck } from "./office-slides.js";
import { TINY_PNG } from "./document-png.js";
import { normalizeCritique } from "./document-critic.js";

const DECK = {
  ir: "deck.v1",
  title: "Q4 launch",
  audience: "the Board",
  slides: [
    { layout: "title", kicker: "Board briefing" },
    {
      layout: "split-visual",
      title: "The product",
      bullets: ["Ships this quarter"],
      image: { kind: "generate", prompt: "product photography of the launch" },
    },
    {
      layout: "chart",
      title: "Budget",
      chart: {
        type: "bar",
        categories: ["Ads", "Events"],
        series: [{ name: "GBP", values: [120, 80] }],
      },
    },
  ],
};

const stubPages = async (): Promise<Buffer[]> => [TINY_PNG, TINY_PNG, TINY_PNG];

function isZip(body: Buffer): boolean {
  return body.length > 4 && body[0] === 0x50 && body[1] === 0x4b;
}

test("unknown layouts fall back and extra slides are dropped", () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Cap",
    slides: Array.from({ length: 25 }, (_, i) => ({
      layout: i === 0 ? "mystery" : "bullets",
      title: `S${i}`,
      bullets: ["One"],
    })),
  });
  assert.equal(deck.slides.length, MAX_SLIDES);
  assert.equal(deck.slides[0]?.layout, "bullets");
});

test("a slide cannot carry more than four supports", () => {
  const deck = parseDeck({
    ir: "deck.v1",
    title: "Cap",
    slides: [
      {
        layout: "bullets",
        title: "Launch needs four owners, not a dump",
        bullets: ["A", "B", "C", "D", "E", "F"],
      },
    ],
  });
  assert.equal(MAX_SUPPORTS, 4);
  assert.equal(deck.slides[0]?.bullets?.length, 4);
});

test("a healthy run compiles a deck and the critic can pass", async () => {
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 8,
    generateImage: async () => TINY_PNG,
    renderPages: stubPages,
    critic: async () => ({ score: 96, pass: true, issues: [] }),
  });
  assert.equal(result.compiles, 1);
  assert.equal(result.criticPassed, true);
  assert.equal(result.criticScore, 96);
  assert.equal(result.imagesGenerated, 3);
  assert.ok(isZip(result.body));
  assert.ok(result.trace.some((line) => /visual QA/i.test(line)));
});

test("a seventh critic turn is impossible", async () => {
  let criticCalls = 0;
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 0,
    renderPages: stubPages,
    critic: async (deck) => {
      criticCalls += 1;
      return {
        score: 40,
        pass: false,
        issues: ["too much text"],
        irPatch: { slides: deck.slides },
      };
    },
  });
  assert.equal(MAX_CRITIQUE_ROUNDS, 6);
  assert.equal(criticCalls, 6);
  assert.equal(result.compiles, 6);
  assert.equal(result.criticPassed, false);
  assert.ok(result.criticScore < VISUAL_PASS_SCORE);
  assert.ok(isZip(result.body));
});

test("score 94 never auto-passes even with three photographs", async () => {
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 8,
    generateImage: async () => TINY_PNG,
    renderPages: stubPages,
    critic: async () => ({ score: 94, pass: true, issues: ["topic titles"] }),
  });
  assert.equal(result.criticPassed, false);
  assert.equal(result.criticScore, 94);
  assert.equal(result.imagesGenerated, 3);
  assert.ok(isZip(result.body));
});

test("invalid visual JSON never passes", async () => {
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 8,
    generateImage: async () => TINY_PNG,
    renderPages: stubPages,
    critic: async () => ({ pass: false, issues: ["visual QA returned invalid JSON"] }),
  });
  assert.equal(result.criticPassed, false);
  assert.equal(result.criticScore, 0);
  assert.equal(result.imagesGenerated, 3);
  assert.ok(isZip(result.body));
});

test("a hung critic returns the first compile", async () => {
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 0,
    renderPages: stubPages,
    budget: { criticTimeoutMs: 30, wallClockMs: 5_000, critiqueRounds: 6 },
    critic: () => new Promise(() => {}),
  });
  assert.equal(result.compiles, 1);
  assert.equal(result.degraded, true);
  assert.equal(result.criticPassed, false);
  assert.ok(isZip(result.body));
  assert.ok(result.trace.some((line) => /timed out|0\/100/i.test(line)));
});

test("zero remaining images still produces a deck and never generates", async () => {
  let calls = 0;
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 0,
    generateImage: async () => {
      calls += 1;
      return TINY_PNG;
    },
    renderPages: stubPages,
    critic: async () => ({ score: 96, pass: true, issues: [] }),
  });
  assert.equal(calls, 0);
  assert.equal(result.imagesGenerated, 0);
  assert.ok(isZip(result.body));
  assert.ok(result.trace.some((line) => /meter empty/i.test(line)));
});

test("an unreachable cell degrades to the current renderer", async () => {
  const result = await compileWorkFile({
    tool: "create_slides",
    args: { title: "Legacy", slides: [{ title: "One", bullets: ["A"] }] },
    imagesRemaining: 0,
    callCell: async () => {
      throw new Error("unreachable");
    },
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.degraded, true);
  assert.equal(result.criticPassed, false);
  assert.ok(result.trace.some((line) => /degraded/i.test(line)));
  assert.ok(isZip(result.body));
});

test("IR rasters to PNG pages", () => {
  const pages = rasterDeck(parseDeck(DECK));
  assert.equal(pages.length, 3);
  for (const page of pages) {
    assert.equal(page.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
});

test("a deck without pictures still gets three image slots", () => {
  const deck = ensureDeckImages(
    parseDeck({
      ir: "deck.v1",
      title: "Q4",
      slides: [
        { layout: "title", title: "Q4" },
        {
          layout: "chart",
          title: "Budget",
          chart: { type: "bar", categories: ["Ads"], series: [{ name: "GBP", values: [1] }] },
        },
      ],
    }),
  );
  assert.ok(imageSlots(deck).length >= MIN_IMAGES);
  const chart = deck.slides.find((s) => s.layout === "chart");
  assert.ok(chart);
  assert.notEqual(chart?.image?.kind, "generate");
});

test("a generate slot on a metric-row is stripped and three photos still exist", () => {
  const deck = ensureDeckImages(
    parseDeck({
      ir: "deck.v1",
      title: "Q4 held",
      slides: [
        { layout: "title", title: "Q4 held" },
        {
          layout: "metric-row",
          title: "Revenue Performance",
          metrics: [{ label: "ARR", value: "$4.2M", subtext: "112% of target" }],
          image: { kind: "generate", prompt: "abstract growth" },
        },
        { layout: "split-visual", title: "Launch floor", bullets: ["Teams at capacity"] },
      ],
    }),
  );
  const metrics = deck.slides.find((s) => s.layout === "metric-row");
  assert.notEqual(metrics?.image?.kind, "generate");
  assert.ok(imageSlots(deck).length >= MIN_IMAGES);
  assert.equal(metrics?.metrics?.[0]?.detail, "112% of target");
});

test("a short critic patch does not drop later slides", () => {
  const deck = parseDeck(DECK);
  const next = applyDeckPatch(deck, {
    slides: [{ title: "SSO ships 15 Nov; marketplace waits" }],
  });
  assert.equal(next.slides.length, deck.slides.length);
  assert.equal(next.slides[0]?.title, "SSO ships 15 Nov; marketplace waits");
  assert.equal(next.slides[1]?.layout, "split-visual");
});

test("vision cannot pass a deck that is missing photographs", async () => {
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 8,
    generateImage: async () => null,
    renderPages: stubPages,
    critic: async () => ({ score: 96, pass: true, issues: [] }),
  });
  assert.equal(result.criticPassed, false);
  assert.ok(result.criticScore < VISUAL_PASS_SCORE);
  assert.ok(isZip(result.body));
});

test("code, not the model boolean, decides pass at 95", () => {
  assert.equal(normalizeCritique({ score: 94, pass: true, issues: [] }).pass, false);
  assert.equal(normalizeCritique({ score: 95, pass: false, issues: [] }).pass, true);
  assert.equal(normalizeCritique({ pass: true, issues: [] }).score, 100);
  assert.equal(VISUAL_PASS_SCORE, 95);
});

test("LibreOffice exports each slide as a PNG", { skip: !isLibreOfficeAvailable() }, async () => {
  const compiled = await compileDeck(parseDeck(DECK));
  const pages = await renderPptxPages(compiled.body);
  assert.equal(pages.length, 3);
  for (const page of pages) {
    assert.equal(page.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(page.length > 800);
    assert.equal(page.readUInt32BE(16) > 1000, true);
  }
});
