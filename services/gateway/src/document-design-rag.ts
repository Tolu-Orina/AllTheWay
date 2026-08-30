import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SLIDE_DESIGN_COLLECTION,
  expandTheme,
  flattenDeckGraph,
  nearestDesigns,
  rerankBySlotSchema,
  schemaScore,
  slotSchemaOfNode,
  slotSchemaOfSlide,
  type DeckGraph,
  type SlideDesignNode,
} from "./document-design.js";
import type { DeckIr } from "./office-ir.js";
import { downloadGcsUri } from "./document-design-gcs.js";
import { embedSlideQuery } from "./document-multimodal-embed.js";

/**
 * Product catalog of designed slides. Not user documents.
 * Screenshots in GCS. gemini-embedding-2 vectors in Firestore slideDesigns
 * (1536). Local JSON is the offline fallback.
 */

export function catalogRoot(): string | null {
  const named = process.env.SLIDE_DESIGN_CATALOG;
  if (named && existsSync(named)) return named;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tries = [
    path.resolve(here, "../../document-cell/catalog"),
    path.resolve(process.cwd(), "services/document-cell/catalog"),
    path.resolve(process.cwd(), "../document-cell/catalog"),
  ];
  return tries.find((dir) => existsSync(dir)) ?? null;
}

export function loadDesignCatalog(root = catalogRoot()): SlideDesignNode[] {
  if (!root) return [];
  const files = readdirSync(root).filter((name) => name.endsWith(".json"));
  const nodes: SlideDesignNode[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(root, file), "utf8")) as
        | SlideDesignNode
        | SlideDesignNode[]
        | DeckGraph;
      if (isDeckGraph(raw)) {
        nodes.push(...flattenDeckGraph(raw));
        continue;
      }
      const listed = Array.isArray(raw) ? raw : [raw];
      for (const node of listed) {
        if (node && "id" in node && (node as SlideDesignNode).id && (node as SlideDesignNode).themeId) {
          nodes.push(node as SlideDesignNode);
        }
      }
    } catch {
      /* skip a broken catalog file rather than failing the cell */
    }
  }
  return nodes;
}

function isDeckGraph(raw: unknown): raw is DeckGraph {
  if (!raw || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  return typeof rec.overall_deck_description === "string" && !!rec.slides && typeof rec.slides === "object" && !Array.isArray(raw);
}

/** PNG path from a catalog node. Bytes stay on disk — the JSON only stores the path. */
export function resolveSlideImage(imagePath: string | undefined): string | null {
  if (!imagePath) return null;
  if (path.isAbsolute(imagePath) && existsSync(imagePath)) return imagePath;
  const root = catalogRoot();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tries = [
    path.resolve(process.cwd(), imagePath),
    root ? path.join(root, imagePath) : "",
    path.resolve(here, "../../../.local-artifacts/samples", imagePath),
    path.resolve(process.cwd(), ".local-artifacts/samples", imagePath),
    process.env.SLIDE_DESIGN_SAMPLES
      ? path.join(process.env.SLIDE_DESIGN_SAMPLES, imagePath)
      : "",
  ];
  return tries.find((dir) => dir && existsSync(dir)) ?? null;
}

export type RetrievedDeck = {
  id: string;
  title: string;
  width: number;
  height: number;
  overall_deck_description: string;
  slides: Array<{
    id: string;
    index: number;
    layout: string;
    prevId: string | null;
    nextId: string | null;
    coordinates: SlideDesignNode["geometry"];
    description: SlideDesignNode["description"];
    slotSchema: ReturnType<typeof slotSchemaOfNode>;
    boxes: SlideDesignNode["description"]["boxes"];
    images: SlideDesignNode["description"]["images"];
  }>;
};

export function groupRetrievedDecks(nodes: SlideDesignNode[]): RetrievedDeck[] {
  const decks: RetrievedDeck[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.themeId)) continue;
    seen.add(node.themeId);
    const slides = nodes
      .filter((n) => n.themeId === node.themeId)
      .sort((a, b) => a.slideIndex - b.slideIndex);
    decks.push({
      id: node.themeId,
      title: node.themeTitle,
      width: node.width,
      height: node.height,
      overall_deck_description: node.deckDescription,
      slides: slides.map((slide) => ({
        id: slide.id,
        index: slide.slideIndex,
        layout: slide.layout,
        prevId: slide.prevId,
        nextId: slide.nextId,
        coordinates: slide.geometry,
        description: slide.description,
        slotSchema: slotSchemaOfNode(slide),
        boxes: slide.description.boxes,
        images: slide.description.images,
      })),
    });
  }
  return decks;
}

/** Hit + previous + next (the graph walk). Cover/close fill in if a neighbor is missing. */
export function pickCoherenceSlides(nodes: SlideDesignNode[], cap = 3): SlideDesignNode[] {
  const hit = nodes[0];
  if (!hit) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const picked: SlideDesignNode[] = [];
  const add = (node: SlideDesignNode | undefined) => {
    if (node && !picked.some((n) => n.id === node.id) && picked.length < cap) picked.push(node);
  };
  add(hit.prevId ? byId.get(hit.prevId) : undefined);
  add(hit);
  add(hit.nextId ? byId.get(hit.nextId) : undefined);
  const sorted = [...nodes].sort((a, b) => a.slideIndex - b.slideIndex);
  add(sorted[0]);
  add(sorted[sorted.length - 1]);
  return picked;
}

export async function loadCoherenceImages(
  nodes: SlideDesignNode[],
  cap = 3,
): Promise<Array<{ role: string; bytes: Buffer }>> {
  const { readFile } = await import("node:fs/promises");
  const out: Array<{ role: string; bytes: Buffer }> = [];
  for (const node of pickCoherenceSlides(nodes, cap)) {
    const bytes = await loadSlideImageBytes(node, readFile);
    if (!bytes?.length) continue;
    out.push({
      role: `${node.themeTitle} slide ${node.slideIndex + 1} (${node.layout}) — retrieved screenshot`,
      bytes,
    });
  }
  return out;
}

async function loadSlideImageBytes(
  node: SlideDesignNode,
  readFile: (path: string) => Promise<Buffer>,
): Promise<Buffer | null> {
  if (node.gcsUri) {
    try {
      return await downloadGcsUri(node.gcsUri);
    } catch {
      /* fall through to a local sample PNG */
    }
  }
  const file = resolveSlideImage(node.imagePath);
  if (!file) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function retrieveSlideDesigns(
  query: string,
  limit = 3,
  brief?: DeckIr,
): Promise<SlideDesignNode[]> {
  const fromStore = await retrieveFromFirestore(query, limit).catch(() => [] as SlideDesignNode[]);
  if (fromStore[0]) {
    const theme = await loadThemeOrHits(fromStore[0], fromStore);
    const extra: SlideDesignNode[] = [];
    const seen = new Set([fromStore[0].themeId]);
    for (const hit of fromStore.slice(1)) {
      if (seen.has(hit.themeId)) continue;
      seen.add(hit.themeId);
      const siblings = await loadThemeOrHits(hit, fromStore).catch(() => [hit]);
      extra.push(...expandTheme(hit, siblings, 4));
      if (extra.length >= 4) break;
    }
    const nodes = [...expandTheme(fromStore[0], theme, 12), ...extra];
    return brief ? rerankBySlotSchema(nodesWithSchema(nodes), brief) : nodes;
  }
  const catalog = loadDesignCatalog();
  const hits = nearestDesigns(query, catalog, limit);
  const hit = hits[0];
  if (!hit) return [];
  const extra: SlideDesignNode[] = [];
  const seenTheme = new Set([hit.themeId]);
  for (const next of hits.slice(1)) {
    if (seenTheme.has(next.themeId)) continue;
    seenTheme.add(next.themeId);
    extra.push(...expandTheme(next, catalog, 4));
    if (extra.length >= 4) break;
  }
  const nodes = [...expandTheme(hit, catalog, 12), ...extra];
  return brief ? rerankBySlotSchema(nodesWithSchema(nodes), brief) : nodes;
}

function nodesWithSchema(nodes: SlideDesignNode[]): SlideDesignNode[] {
  return nodes.map((node) => ({ ...node, slotSchema: slotSchemaOfNode(node) }));
}

async function loadThemeOrHits(hit: SlideDesignNode, fallback: SlideDesignNode[]): Promise<SlideDesignNode[]> {
  try {
    const { loadThemeSlides } = await import("./document-design-store.js");
    const theme = await loadThemeSlides(hit.themeId, hit.slideCount ?? 30);
    if (theme.length) return theme;
  } catch {
    /* emulator or missing index — use the nearest hits */
  }
  return fallback.filter((node) => node.themeId === hit.themeId);
}

async function retrieveFromFirestore(query: string, limit: number): Promise<SlideDesignNode[]> {
  if (process.env.FIRESTORE_EMULATOR_HOST) return [];
  const vector = await embedSlideQuery(query);
  if (!vector) return [];
  const { db } = await import("./firestore.js");
  const coll = db.collection(SLIDE_DESIGN_COLLECTION) as unknown as {
    findNearest: (opts: {
      vectorField: string;
      queryVector: number[];
      limit: number;
      distanceMeasure: string;
    }) => { get: () => Promise<{ docs: Array<{ data: () => unknown }> }> };
  };
  if (typeof coll.findNearest !== "function") return [];
  const snap = await coll
    .findNearest({
      vectorField: "embedding",
      queryVector: vector,
      limit,
      distanceMeasure: "COSINE",
    })
    .get();
  return snap.docs.map((doc) => doc.data() as SlideDesignNode).filter((n) => n?.id);
}

export async function embedQuery(text: string): Promise<number[] | null> {
  return embedSlideQuery(text);
}

export async function embedDocument(text: string): Promise<number[] | null> {
  return embedSlideQuery(text);
}

export { rerankBySlotSchema, schemaScore, slotSchemaOfNode, slotSchemaOfSlide };
