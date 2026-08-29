import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The same eight archetypes locally and on Cloud Run. Missing files skip;
 * the system prompt still describes the bar. Order is stable so Vertex
 * implicit cache can reuse the prefix.
 */

export type ReferencePage = { role: string; bytes: Buffer };

export const REFERENCE_SPECS: Array<{ file: string; role: string }> = [
  {
    file: "01-cover.jpg",
    role: "Cover: black type in empty sky, photograph along the lower half, two-tone teal/coral hairline, tiny chrome.",
  },
  {
    file: "02-agenda.jpg",
    role: "Agenda/TOC: full-bleed teal, giant white title, items in three columns.",
  },
  {
    file: "03-numbered.jpg",
    role: "Numbered points: two-tone hairline, 2×2 grid, teal numbered circles, no wash boxes.",
  },
  {
    file: "04-section.jpg",
    role: "Section divider: full-bleed photograph, giant white title in empty shadow.",
  },
  {
    file: "05-split.jpg",
    role: "Split visual: copy on the left, photograph bleeding to the right edge.",
  },
  {
    file: "06-overlap.jpg",
    role: "Photograph overlapping the type column — crop to the edge, not a postage-stamp in a round-rect.",
  },
  {
    file: "07-metrics.jpg",
    role: "Metrics: huge teal numbers, short labels, dashed column rules, no filled cards.",
  },
  {
    file: "08-thanks.jpg",
    role: "Closing: black type on white, landscape photograph along the bottom half.",
  },
];

let cached: ReferencePage[] | undefined;

export function resetReferencePagesForTests(): void {
  cached = undefined;
}

export async function loadReferencePages(): Promise<ReferencePage[]> {
  if (cached) return cached;
  const root = referenceRoot();
  if (!root) {
    cached = [];
    return cached;
  }
  const pages: ReferencePage[] = [];
  for (const spec of REFERENCE_SPECS) {
    const file = path.join(root, spec.file);
    if (!existsSync(file)) continue;
    const bytes = await readFile(file);
    if (bytes.length < 64) continue;
    pages.push({ role: spec.role, bytes });
  }
  cached = pages;
  return cached;
}

export function referenceRoot(): string | null {
  const named = process.env.SLIDE_REFERENCE_DIR;
  if (named && existsSync(named)) return named;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tries = [
    path.resolve(here, "../../document-cell/references"),
    path.resolve(process.cwd(), "services/document-cell/references"),
    path.resolve(process.cwd(), "../document-cell/references"),
  ];
  return tries.find((dir) => existsSync(dir)) ?? null;
}
