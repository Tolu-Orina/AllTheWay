/**
 * Generate and validate one slide_design_description.
 *
 *   npx tsx scripts/describe-one-slide.ts
 *
 * Reads the Consulting proposal .pptx (real OOXML x/y) plus its screenshot,
 * asks Gemini 3.7 Flash for the description, and checks boxes against geometry.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractPptxGeometry } from "../src/document-pptx-geometry.js";
import { describeSlideDesign } from "../src/document-design-describe.js";
import { descriptionToText, validateDescription } from "../src/document-design.js";
import { embedDocument } from "../src/document-design-rag.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PPTX = path.join(ROOT, ".local-artifacts/samples/Consulting proposal.pptx");
const PNG = path.join(ROOT, ".local-artifacts/samples/consulting-proposal/slide-01.png");
const OUT_DIR = path.join(ROOT, "services/document-cell/catalog");

async function main(): Promise<void> {
  if (!existsSync(PPTX)) {
    console.error(`Missing sample PPTX: ${PPTX}`);
    process.exit(1);
  }
  const pptx = await readFile(PPTX);
  const geometry = await extractPptxGeometry(pptx);
  const slide = geometry.slides[0];
  if (!slide) {
    console.error("No slides in the sample PPTX");
    process.exit(1);
  }
  const png = existsSync(PNG) ? await readFile(PNG) : undefined;
  const description = await describeSlideDesign({
    geometry: slide,
    png,
    themeTitle: geometry.title,
  });
  const check = validateDescription(slide.boxes, description);
  const descriptionText = descriptionToText(description);
  const embedding = await embedDocument(descriptionText);
  const node = {
    id: "consulting-proposal-0",
    themeId: "consulting-proposal",
    themeTitle: geometry.title,
    slideIndex: 0,
    prevId: null,
    nextId: geometry.slides.length > 1 ? "consulting-proposal-1" : null,
    layout: description.layout,
    description,
    descriptionText,
    geometry: slide.boxes,
    embedding: embedding ?? undefined,
  };
  await mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, "consulting-proposal-0.json");
  await writeFile(out, JSON.stringify(node, null, 2));
  console.log(
    JSON.stringify(
      {
        title: geometry.title,
        canvas: { w: geometry.width, h: geometry.height },
        extractedBoxes: slide.boxes.length,
        layout: slide.layout,
        description,
        validation: check,
        catalog: out,
        embeddingDims: embedding?.length ?? 0,
      },
      null,
      2,
    ),
  );
  if (!check.ok) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
