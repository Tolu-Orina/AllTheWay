/**
 * Local visual QA: compile a board deck, screenshot it in LibreOffice, score
 * with Gemini 3.7 Flash, redo below 95, max 6 turns.
 *
 *   npx tsx scripts/visual-qa-local.ts
 *
 * Needs soffice, ADC, and GOOGLE_CLOUD_PROJECT (not alltheway-local).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateStill } from "../src/document-images.js";
import { renderPptxPagesOrThrow } from "../src/document-libreoffice.js";
import { critiqueDeck, vertexVision } from "../src/document-critic.js";
import { runDocumentQuality } from "../src/document-quality.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(ROOT, ".local-artifacts", "qa-lo-95");

const DECK = {
  ir: "deck.v1",
  title: "Hold the Q4 GTM overspend",
  audience: "the Board",
  date: "29 August 2026",
  slides: [
    {
      layout: "title",
      title: "Hold the Q4 GTM overspend; product stays on plan",
      kicker: "Board decision",
      subtitle: "Prepared for the Board · 29 August 2026",
      image: {
        kind: "generate",
        prompt:
          "Wide cinematic photograph of a quiet executive war-room at dusk, city lights through glass, no people facing camera, no text, no logos",
      },
    },
    {
      layout: "two-card",
      title: "SSO ships 15 Nov; marketplace waits until identity is staffed",
      cards: [
        { title: "Ships", body: "SSO and billing freeze on 15 Nov. Elena owns the cut. No new GTM campaigns after 30 Sep." },
        { title: "Waits", body: "Marketplace and partner portal slip to Q1. They share the identity queue that SSO consumes." },
      ],
    },
    {
      layout: "metric-row",
      title: "Product held 112% of ARR; GTM is 18 points over its cost envelope",
      metrics: [
        { label: "ARR", value: "£6.4m", owner: "Elena", detail: "112% of plan · Finance close" },
        { label: "GTM spend", value: "£1.9m", owner: "Priya", detail: "118% of envelope · Finance close" },
        { label: "Runway", value: "11 mo", owner: "Board", detail: "At current burn · Finance close" },
      ],
    },
    {
      layout: "split-visual",
      title: "The launch floor is at capacity; more ads will not convert",
      bullets: [
        "Implementation slots are full through November",
        "Win-rate fell 6 pts when we added the May campaign",
        "Source: Salesforce + Finance close, week 34",
      ],
      image: {
        kind: "generate",
        prompt:
          "Editorial photograph of an implementation team at a real office whiteboard, candid, no faces sharp, no text, no logos",
      },
    },
    {
      layout: "chart",
      title: "GTM overspent; product and G&A held the envelope",
      chart: {
        type: "bar",
        categories: ["Product", "GTM", "G&A"],
        series: [{ name: "GBP thousands", values: [820, 1900, 410] }],
      },
    },
    {
      layout: "photo-story",
      title: "Customers already in onboarding will feel a pause more than a new campaign",
      bullets: [
        "Twelve enterprise logos are in implementation now",
        "Source: Customer success snapshot, 22 Aug 2026",
      ],
      image: {
        kind: "generate",
        prompt:
          "Photograph of customers in a real onboarding workshop around a table, documentary, no text, no logos",
      },
    },
    {
      layout: "closing-ask",
      title: "Vote to freeze GTM spend at £1.6m for Q4 and keep the 15 Nov SSO date",
      asks: [
        "Approve the GTM freeze at £1.6m — Priya, this week",
        "Protect SSO 15 Nov staffing — Elena, Monday",
        "Revisit marketplace in the November board",
      ],
    },
  ],
};

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  let turn = 0;
  const result = await runDocumentQuality({
    tool: "create_slides",
    args: DECK,
    imagesRemaining: 8,
    generateImage: generateStill,
    critic: async (deck, pages) => critiqueDeck(deck, pages, vertexVision),
    renderPages: async (pptx) => {
      turn += 1;
      const pages = await renderPptxPagesOrThrow(pptx);
      const dir = path.join(OUT, `turn-${turn}`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "deck.pptx"), pptx);
      for (let i = 0; i < pages.length; i++) {
        await writeFile(path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`), pages[i]!);
      }
      return pages;
    },
  });
  await writeFile(path.join(OUT, "final.pptx"), result.body);
  await writeFile(
    path.join(OUT, "trace.json"),
    JSON.stringify(
      {
        criticPassed: result.criticPassed,
        criticScore: result.criticScore,
        compiles: result.compiles,
        degraded: result.degraded,
        imagesGenerated: result.imagesGenerated,
        trace: result.trace,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        out: OUT,
        criticPassed: result.criticPassed,
        criticScore: result.criticScore,
        compiles: result.compiles,
        degraded: result.degraded,
        imagesGenerated: result.imagesGenerated,
        bytes: result.body.length,
        trace: result.trace,
      },
      null,
      2,
    ),
  );
  if (!result.criticPassed) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
