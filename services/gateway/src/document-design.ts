/**
 * Graph RAG for slide design: a theme is a parent, slides are ordered
 * children. Retrieval is nearest description, then walk the theme so
 * hierarchy is preserved.
 *
 * Product catalog — not user documents. Lives at slideDesigns, never
 * under users/{uid}. Embeddings are gemini-embedding-2 (image + description
 * + coordinates) truncated to 1536, the same Firestore width as documentChunks.
 * Screenshots live in GCS; Firestore holds the vector and the graph.
 */

import { OFFICE_LAYOUTS, type SlideLayout } from "./office-ir.js";
import type { PptxBox } from "./document-pptx-geometry.js";

export const SLIDE_DESIGN_COLLECTION = "slideDesigns";
/** gemini-embedding-2 default is 3072; Firestore caps at 2048. 1536 is the working width. */
export const EMBEDDING_DIMENSIONS = 1536;
export const SLIDE_EMBEDDING_MODEL = process.env.SLIDE_EMBEDDING_MODEL || "gemini-embedding-2";
export const SLIDE_EMBEDDING_LOCATION = process.env.SLIDE_EMBEDDING_LOCATION || "global";

export type SlideDesignDescription = {
  looksLike: string;
  title: string;
  layout: SlideLayout;
  background: {
    scope: "deck" | "slide";
    fill?: string;
    kind: "solid" | "photograph" | "none";
  };
  contentPlacement: string;
  images: Array<{
    kind: "background" | "picture";
    what: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  boxes: Array<{
    role: string;
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    fontSize?: number;
  }>;
};

export type DeckGraphSlide = {
  index: number;
  prev: string | null;
  next: string | null;
  image: string;
  gcsUri?: string;
  coordinates: PptxBox[];
  description: SlideDesignDescription;
};

export type DeckGraph = {
  id: string;
  title: string;
  source: string;
  width: number;
  height: number;
  overall_deck_description: string;
  slides: Record<string, DeckGraphSlide>;
};

export type SlideDesignNode = {
  id: string;
  themeId: string;
  themeTitle: string;
  slideIndex: number;
  prevId: string | null;
  nextId: string | null;
  layout: SlideLayout;
  description: SlideDesignDescription;
  descriptionText: string;
  deckDescription: string;
  width: number;
  height: number;
  slideCount?: number;
  geometry: PptxBox[];
  imagePath?: string;
  gcsUri?: string;
  embedding?: number[];
};

export function slideKey(index: number): string {
  return `slide-${String(index + 1).padStart(2, "0")}`;
}

export function flattenDeckGraph(deck: DeckGraph): SlideDesignNode[] {
  const keys = Object.keys(deck.slides).sort();
  return keys.map((id) => {
    const slide = deck.slides[id]!;
    return {
      id: `${deck.id}:${id}`,
      themeId: deck.id,
      themeTitle: deck.title,
      slideIndex: slide.index,
      prevId: slide.prev ? `${deck.id}:${slide.prev}` : null,
      nextId: slide.next ? `${deck.id}:${slide.next}` : null,
      layout: slide.description.layout,
      description: slide.description,
      descriptionText: [deck.overall_deck_description, descriptionToText(slide.description)].join("\n"),
      deckDescription: deck.overall_deck_description,
      width: deck.width,
      height: deck.height,
      slideCount: keys.length,
      geometry: slide.coordinates,
      imagePath: slide.image,
      gcsUri: slide.gcsUri,
    };
  });
}

/** Text fused with the screenshot for gemini-embedding-2. */
export function slideEmbedText(node: Pick<SlideDesignNode, "deckDescription" | "themeTitle" | "slideIndex" | "layout" | "description" | "width" | "height" | "geometry">): string {
  return [
    node.deckDescription,
    `Theme ${node.themeTitle}. Slide ${node.slideIndex + 1}, layout ${node.layout}, canvas ${node.width}×${node.height} in.`,
    descriptionToText(node.description),
    ...node.geometry.slice(0, 16).map(
      (box) => `${box.kind} ${box.placeholder ?? ""} ${(box.text ?? "").slice(0, 40)} at (${box.x},${box.y}) ${box.w}x${box.h}`,
    ),
  ].join("\n");
}

export function descriptionToText(desc: SlideDesignDescription): string {
  return [
    desc.looksLike,
    `Title: ${desc.title}`,
    `Layout: ${desc.layout}`,
    `Background (${desc.background.scope}): ${desc.background.kind}${desc.background.fill ? ` #${desc.background.fill}` : ""}`,
    desc.contentPlacement,
    ...desc.images.map(
      (img) => `${img.kind} ${img.what} at (${img.x},${img.y}) ${img.w}x${img.h}`,
    ),
    ...desc.boxes.map((box) => `${box.role} "${box.text}" at (${box.x},${box.y}) ${box.w}x${box.h}`),
  ].join("\n");
}

export function isOfficeLayout(value: string): value is SlideLayout {
  return (OFFICE_LAYOUTS as readonly string[]).includes(value);
}

export function expandTheme(hit: SlideDesignNode, catalog: SlideDesignNode[], cap = 8): SlideDesignNode[] {
  const siblings = catalog
    .filter((node) => node.themeId === hit.themeId)
    .sort((a, b) => a.slideIndex - b.slideIndex);
  const ordered = [hit, ...siblings.filter((node) => node.id !== hit.id)];
  const seen = new Set<string>();
  const out: SlideDesignNode[] = [];
  for (const node of ordered) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    if (out.length >= cap) break;
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function nearestDesigns(
  query: number[] | string,
  catalog: SlideDesignNode[],
  limit = 3,
): SlideDesignNode[] {
  if (!catalog.length) return [];
  if (typeof query === "string") {
    const needle = query.toLowerCase();
    return [...catalog]
      .sort(
        (a, b) =>
          scoreText(`${a.deckDescription}\n${a.descriptionText}`, needle) -
          scoreText(`${b.deckDescription}\n${b.descriptionText}`, needle),
      )
      .slice(0, limit);
  }
  return [...catalog]
    .map((node) => ({ node, score: node.embedding?.length ? cosine(query, node.embedding) : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.node);
}

function scoreText(hay: string, needle: string): number {
  const words = needle.split(/\W+/).filter((w) => w.length > 2);
  if (!words.length) return 0;
  const lower = hay.toLowerCase();
  return words.filter((w) => lower.includes(w)).length / words.length;
}

export function boxDistance(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  return Math.hypot(acx - bcx, acy - bcy);
}

export function validateDescription(
  extracted: PptxBox[],
  desc: SlideDesignDescription,
  toleranceIn = 0.35,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const titleBox = extracted.find((b) => b.placeholder === "ctrTitle" || b.placeholder === "title");
  if (titleBox?.text && !desc.title.toLowerCase().includes(titleBox.text.toLowerCase().slice(0, 12))) {
    issues.push(`title mismatch: extracted “${titleBox.text}” vs “${desc.title}”`);
  }
  const texts = extracted.filter((b) => b.kind === "text" && b.text);
  for (const box of texts.slice(0, 6)) {
    const hit = desc.boxes.find((d) => boxDistance(box, d) <= toleranceIn);
    if (!hit) issues.push(`no described box near (${box.x}, ${box.y}) “${(box.text ?? "").slice(0, 40)}”`);
  }
  return { ok: issues.length === 0, issues };
}
