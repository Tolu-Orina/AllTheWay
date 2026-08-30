/**
 * Ingest sample PowerPoints into the multimodal design graph:
 *
 *   screenshot → GCS
 *   screenshot + coordinates + description → gemini-embedding-2
 *   vector + graph → Firestore slideDesigns
 *
 *   npx tsx scripts/ingest-deck-graph.ts --prod
 *   npx tsx scripts/ingest-deck-graph.ts --prod --id case-study
 *
 * --prod writes GCS + Firestore (unsets the emulator). Describe is skipped
 * when catalog JSON already exists unless --redescribe.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DeckGraph, DeckGraphSlide } from "../src/document-design.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = path.join(ROOT, "services/document-cell/catalog");
const SAMPLES = path.join(ROOT, ".local-artifacts/samples");

type Args = {
  prod: boolean;
  redescribe: boolean;
  id?: string;
  project: string;
  bucket: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    prod: false,
    redescribe: false,
    project: process.env.GOOGLE_CLOUD_PROJECT || "alltheway-rinegan",
    bucket: process.env.SLIDE_DESIGN_BUCKET || "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") out.prod = true;
    else if (arg === "--redescribe") out.redescribe = true;
    else if (arg === "--id") out.id = argv[++i];
    else if (arg === "--project") out.project = argv[++i] || out.project;
    else if (arg === "--bucket") out.bucket = argv[++i] || out.bucket;
  }
  if (out.prod && !out.bucket) out.bucket = `${out.project}-slide-designs-prod`;
  return out;
}

function slug(name: string): string {
  return name
    .replace(/\.pptx$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function discoverSamples(): Array<{ id: string; pptx: string; pngDir: string; title: string }> {
  const pptxs = readdirSync(SAMPLES).filter((name) => name.toLowerCase().endsWith(".pptx"));
  const dirs = readdirSync(SAMPLES, { withFileTypes: true })
    .filter((ent) => ent.isDirectory() && existsSync(path.join(SAMPLES, ent.name, "slide-01.png")))
    .map((ent) => ent.name);
  const out: Array<{ id: string; pptx: string; pngDir: string; title: string }> = [];
  for (const dir of dirs) {
    const match =
      pptxs.find((file) => slug(file) === dir) ||
      pptxs.find((file) => slug(file).startsWith(dir)) ||
      pptxs.find((file) => dir.startsWith(slug(file)));
    if (!match) {
      console.error(`no pptx for ${dir}`);
      continue;
    }
    out.push({
      id: dir,
      pptx: match,
      pngDir: dir,
      title: dir.replace(/-/g, " "),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err);
      if (!/429|503|400|truncated|invalid JSON|timeout|failed \(5|embed returned null/i.test(msg) || i === 4) throw err;
      const wait = (i + 1) * 2500;
      console.error(`retry ${label} in ${wait}ms: ${msg.slice(0, 160)}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw last;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.prod) {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    process.env.GOOGLE_CLOUD_PROJECT = args.project;
    process.env.SLIDE_DESIGN_BUCKET = args.bucket;
  }

  const { extractPptxGeometry } = await import("../src/document-pptx-geometry.js");
  const { describeDeckOverall, describeSlideDesign } = await import("../src/document-design-describe.js");
  const { flattenDeckGraph, slideEmbedText, slideKey, validateDescription } = await import(
    "../src/document-design.js"
  );

  const samples = discoverSamples().filter((sample) => !args.id || sample.id === args.id);
  if (!samples.length) {
    console.error(args.id ? `no sample matching --id ${args.id}` : `no samples in ${SAMPLES}`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const summary: Array<Record<string, unknown>> = [];

  for (const sample of samples) {
    const catalogPath = path.join(OUT_DIR, `${sample.id}.json`);
    const pptxPath = path.join(SAMPLES, sample.pptx);
    const pngDir = path.join(SAMPLES, sample.pngDir);
    const existing = !args.redescribe && existsSync(catalogPath)
      ? (JSON.parse(await readFile(catalogPath, "utf8")) as DeckGraph)
      : null;

    let deck: DeckGraph;
    if (existing?.slides && Object.keys(existing.slides).length) {
      deck = existing;
      console.error(`reuse ${sample.id} (${Object.keys(deck.slides).length} slides)`);
    } else {
      const pptx = await readFile(pptxPath);
      const geometry = await extractPptxGeometry(pptx);
      const pngFiles = readdirSync(pngDir)
        .filter((name) => /^slide-\d+\.png$/i.test(name))
        .sort();
      const slides: Record<string, DeckGraphSlide> = {};
      const title =
        geometry.title && !/^presentation$/i.test(geometry.title) ? geometry.title : sample.title;

      for (const [i, slide] of geometry.slides.entries()) {
        const id = slideKey(i);
        const pngName = pngFiles[i];
        const png = pngName ? await readFile(path.join(pngDir, pngName)) : undefined;
        const description = await withRetry(`${sample.id} ${id}`, () =>
          describeSlideDesign({ geometry: slide, png, themeTitle: title }),
        );
        const check = validateDescription(slide.boxes, description);
        slides[id] = {
          index: i,
          prev: i > 0 ? slideKey(i - 1) : null,
          next: i < geometry.slides.length - 1 ? slideKey(i + 1) : null,
          image: `${sample.pngDir}/${pngName ?? `${id}.png`}`,
          coordinates: slide.boxes,
          description,
        };
        console.error(`described ${sample.id} ${id} layout=${description.layout} ok=${check.ok}`);
      }

      const pick = [0, Math.floor(geometry.slides.length / 2), geometry.slides.length - 1].filter(
        (i, pos, all) => all.indexOf(i) === pos && i >= 0 && i < pngFiles.length,
      );
      const pngs: Buffer[] = [];
      for (const i of pick) {
        const name = pngFiles[i];
        if (name) pngs.push(await readFile(path.join(pngDir, name)));
      }
      const overall = await withRetry(`${sample.id} overall`, () =>
        describeDeckOverall({
          title,
          width: geometry.width,
          height: geometry.height,
          slides: geometry.slides.map((s) => ({ index: s.index, layout: s.layout, boxes: s.boxes })),
          pngs,
        }),
      );
      deck = {
        id: sample.id,
        title,
        source: sample.pptx,
        width: geometry.width,
        height: geometry.height,
        overall_deck_description: overall,
        slides,
      };
      await writeFile(catalogPath, JSON.stringify(deck, null, 2));
    }

    let uploaded = 0;
    let embedded = 0;
    if (args.prod) {
      const { uploadSlidePng } = await import("../src/document-design-gcs.js");
      const { embedSlideDocument } = await import("../src/document-multimodal-embed.js");
      const { upsertSlideDesign } = await import("../src/document-design-store.js");
      const nodes = flattenDeckGraph(deck);
      for (const node of nodes) {
        const local = path.join(SAMPLES, node.imagePath || "");
        const png = existsSync(local) ? await readFile(local) : undefined;
        if (png?.length) {
          node.gcsUri = await withRetry(`gcs ${node.id}`, () =>
            uploadSlidePng(sample.id, node.imagePath || `${slideKey(node.slideIndex)}.png`, png),
          );
          uploaded += 1;
          const slide = deck.slides[slideKey(node.slideIndex)];
          if (slide) slide.gcsUri = node.gcsUri;
        }
        node.embedding = await withRetry(`embed ${node.id}`, async () => {
          const vector = await embedSlideDocument({
            text: slideEmbedText(node),
            image: png,
          });
          if (!vector) throw new Error("embed returned null");
          return vector;
        });
        embedded += 1;
        await upsertSlideDesign(node);
        console.error(`prod ${node.id} gcs=${Boolean(node.gcsUri)} dims=${node.embedding?.length ?? 0}`);
      }
      await writeFile(catalogPath, JSON.stringify(deck, null, 2));
    }

    summary.push({
      id: sample.id,
      slides: Object.keys(deck.slides).length,
      catalog: catalogPath,
      uploaded,
      embedded,
    });
  }

  console.log(JSON.stringify({ project: args.prod ? args.project : "local", bucket: args.prod ? args.bucket : "", decks: summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
