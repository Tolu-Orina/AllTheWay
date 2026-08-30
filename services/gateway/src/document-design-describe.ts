import { knownLayout } from "./office-ir.js";
import { CRITIC_MAX_TOKENS } from "./document-budget.js";
import { mimeOf, vertexJson } from "./document-vertex.js";
import {
  isOfficeLayout,
  type SlideDesignDescription,
} from "./document-design.js";
import type { PptxSlideGeometry } from "./document-pptx-geometry.js";

const SLIDE_SYSTEM = [
  "You write a slide_design_description for AllTheWay. You do not talk to the person.",
  "You see a screenshot of a real PowerPoint slide plus the OOXML geometry extracted from that .pptx (inches,  origin top-left).",
  "Return only compact JSON with keys: looksLike, title, layout, background, contentPlacement, images, boxes.",
  "layout MUST be one of: title-slide, section-header, title-and-body, title-and-two-columns, title-only, one-column-text, main-point, section-title-and-description, caption, big-number, blank.",
  "background.scope is deck or slide. background.kind is solid, photograph, or none.",
  "boxes[] and images[] MUST use the extracted x,y,w,h — do not invent new coordinates. Round to 3 decimals.",
  "looksLike is one sentence of what a partner would see. contentPlacement says where the title, body, and photograph sit.",
  "Do not copy lorem as if it were a recommendation. Describe the design, not the dummy copy.",
].join("\n");

export async function describeSlideDesign(opts: {
  geometry: PptxSlideGeometry;
  png?: Buffer;
  themeTitle?: string;
}): Promise<SlideDesignDescription> {
  const parts: Array<Record<string, unknown>> = [
    {
      text:
        `Theme: ${opts.themeTitle || "unknown"}. ` +
        `Extracted OOXML for this slide (inches):\n${JSON.stringify(opts.geometry)}`,
    },
  ];
  if (opts.png?.length) {
    parts.push({ text: "LibreOffice (or packaged) screenshot of this same slide:" });
    parts.push({ inlineData: { mimeType: mimeOf(opts.png), data: opts.png.toString("base64") } });
  }
  const raw = (await vertexJson({
    system: SLIDE_SYSTEM,
    parts,
    temperature: 0.2,
    maxOutputTokens: CRITIC_MAX_TOKENS,
  })) as Record<string, unknown>;
  return normalizeDescription(raw, opts.geometry);
}

export async function describeDeckOverall(opts: {
  title: string;
  width: number;
  height: number;
  slides: Array<{ index: number; layout: string; boxes: unknown }>;
  pngs: Buffer[];
}): Promise<string> {
  const parts: Array<Record<string, unknown>> = [
    {
      text:
        `This is one PowerPoint deck (“${opts.title}”, ${opts.width}×${opts.height} in). ` +
        `Write overall_deck_description: how the deck is designed as a sequence — palette, type, ` +
        `what repeats from slide to slide, where the cover / body / close sit. ` +
        `Do not retell dummy copy. Return JSON {overall_deck_description:string}.\n` +
        JSON.stringify(opts.slides.map((s) => ({ index: s.index, layout: s.layout, boxCount: Array.isArray(s.boxes) ? s.boxes.length : 0 }))),
    },
  ];
  for (const [i, png] of opts.pngs.entries()) {
    if (!png?.length) continue;
    parts.push({ text: `Screenshot ${i + 1} from this same deck:` });
    parts.push({ inlineData: { mimeType: mimeOf(png), data: png.toString("base64") } });
  }
  const raw = (await vertexJson({
    system:
      "You describe how a PowerPoint theme holds together. You do not talk to the person. Return only compact JSON.",
    parts,
    temperature: 0.2,
    maxOutputTokens: 1024,
  })) as Record<string, unknown>;
  const text = String(raw.overall_deck_description ?? "").trim();
  return text || `${opts.title} holds a consistent type and placement system across ${opts.slides.length} slides.`;
}

export function normalizeDescription(
  raw: Record<string, unknown>,
  geometry: PptxSlideGeometry,
): SlideDesignDescription {
  const bg = raw.background && typeof raw.background === "object" ? (raw.background as Record<string, unknown>) : {};
  const layout = isOfficeLayout(String(raw.layout ?? "")) ? (raw.layout as SlideDesignDescription["layout"]) : geometry.layout;
  return {
    looksLike: String(raw.looksLike ?? "").trim() || "A designed slide.",
    title: String(raw.title ?? geometry.boxes.find((b) => b.kind === "text")?.text ?? "Slide"),
    layout: knownLayout(layout),
    background: {
      scope: bg.scope === "deck" ? "deck" : "slide",
      fill: typeof bg.fill === "string" ? String(bg.fill).replace(/^#/, "").toUpperCase() : undefined,
      kind: bg.kind === "photograph" || bg.kind === "solid" ? bg.kind : geometry.background?.picture ? "photograph" : "solid",
    },
    contentPlacement: String(raw.contentPlacement ?? "").trim() || "Title and body follow the extracted boxes.",
    images: Array.isArray(raw.images)
      ? raw.images
          .filter((item) => item && typeof item === "object")
          .map((item) => {
            const rec = item as Record<string, unknown>;
            return {
              kind: rec.kind === "background" ? "background" : "picture",
              what: String(rec.what ?? "photograph"),
              x: Number(rec.x) || 0,
              y: Number(rec.y) || 0,
              w: Number(rec.w) || 0,
              h: Number(rec.h) || 0,
            };
          })
      : geometry.boxes
          .filter((b) => b.kind === "picture")
          .map((b) => ({ kind: "picture" as const, what: "photograph", x: b.x, y: b.y, w: b.w, h: b.h })),
    boxes: Array.isArray(raw.boxes)
      ? raw.boxes
          .filter((item) => item && typeof item === "object")
          .map((item) => {
            const rec = item as Record<string, unknown>;
            return {
              role: String(rec.role ?? "body"),
              text: String(rec.text ?? ""),
              x: Number(rec.x) || 0,
              y: Number(rec.y) || 0,
              w: Number(rec.w) || 0,
              h: Number(rec.h) || 0,
              fontSize: Number(rec.fontSize) || undefined,
            };
          })
      : geometry.boxes
          .filter((b) => b.kind === "text" && b.text)
          .map((b) => ({
            role: b.placeholder === "ctrTitle" || b.placeholder === "title" ? "title" : "body",
            text: b.text ?? "",
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            fontSize: b.fontSize,
          })),
  };
}
