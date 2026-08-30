/**
 * Raster every sample .pptx in .local-artifacts/samples to slide-01.png …
 * using LibreOffice. Skips decks that already have PNGs.
 *
 *   npx tsx scripts/raster-sample-pptx.ts
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isLibreOfficeAvailable, renderPptxPages } from "../src/document-libreoffice.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SAMPLES = path.join(ROOT, ".local-artifacts", "samples");
const SOFFICE_MS = 300_000;

function slug(name: string): string {
  return name
    .replace(/\.pptx$/i, "")
    .replace(/\s+Presentation$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main(): Promise<void> {
  if (!isLibreOfficeAvailable()) {
    throw new Error("LibreOffice is not installed");
  }
  const names = (await readdir(SAMPLES)).filter((n) => /\.pptx$/i.test(n)).sort();
  if (!names.length) throw new Error(`No .pptx in ${SAMPLES}`);

  for (const name of names) {
    const dir = path.join(SAMPLES, slug(name));
    const existing = existsSync(dir)
      ? (await readdir(dir)).filter((n) => /^slide-\d+\.png$/i.test(n)).length
      : 0;
    if (existing > 0) {
      console.log(`skip ${name} (${existing} pngs in ${path.basename(dir)})`);
      continue;
    }
    console.log(`raster ${name} → ${path.basename(dir)}/`);
    const started = Date.now();
    const pages = await renderPptxPages(await readFile(path.join(SAMPLES, name)), {
      sofficeTimeoutMs: SOFFICE_MS,
    });
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < pages.length; i++) {
      await writeFile(path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`), pages[i]!);
    }
    console.log(`  ${pages.length} slides in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
