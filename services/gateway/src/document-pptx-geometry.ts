/**
 * Geometry from the PPTX itself — the file LibreOffice opens.
 *
 * Screenshots cannot recover x/y. OOXML already stores every shape in EMUs
 * (slide, then layout, then master). That is the same tree UNO would report.
 */

import JSZip from "jszip";

import { knownLayout, type SlideLayout } from "./office-ir.js";

const EMU = 914400;

export type PptxBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "text" | "picture" | "shape";
  text?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  placeholder?: string;
  name?: string;
};

export type PptxSlideGeometry = {
  index: number;
  layout: SlideLayout;
  layoutFile?: string;
  background?: { fill?: string; picture?: boolean };
  boxes: PptxBox[];
};

export type PptxDeckGeometry = {
  title: string;
  width: number;
  height: number;
  slides: PptxSlideGeometry[];
};

export async function extractPptxGeometry(pptx: Buffer): Promise<PptxDeckGeometry> {
  const zip = await JSZip.loadAsync(pptx);
  const presentation = await readXml(zip, "ppt/presentation.xml");
  const size = sldSz(presentation);
  const rels = parseRels(await readXml(zip, "ppt/_rels/presentation.xml.rels"));
  const title = await coreTitle(zip);
  const slideFiles = [...rels.entries()]
    .filter(([, target]) => /ppt\/slides\/slide\d+\.xml$/i.test(norm(target)) || /slides\/slide\d+\.xml$/i.test(target))
    .map(([, target]) => resolvePpt(target))
    .sort((a, b) => slideNum(a) - slideNum(b));

  const slides: PptxSlideGeometry[] = [];
  for (const file of slideFiles) {
    const xml = await readXml(zip, file);
    const slideRels = parseRels(await readXml(zip, relsPath(file)));
    const layoutTarget = [...slideRels.values()].find((t) => /slideLayout\d+\.xml/i.test(t));
    const layoutFile = layoutTarget ? resolveFrom(file, layoutTarget) : undefined;
    const layoutXml = layoutFile ? await readXml(zip, layoutFile) : "";
    const layoutRels = layoutFile ? parseRels(await readXml(zip, relsPath(layoutFile))) : new Map<string, string>();
    const boxes = mergeLayout(collectBoxes(xml), collectBoxes(layoutXml));
    slides.push({
      index: slides.length,
      layout: inferLayout(boxes),
      layoutFile,
      background: backgroundOf(xml, layoutXml, layoutRels),
      boxes,
    });
  }

  return {
    title,
    width: size.w || 13.333,
    height: size.h || 7.5,
    slides,
  };
}

export function inchesFromEmu(emu: number): number {
  return Math.round((emu / EMU) * 1000) / 1000;
}

function collectBoxes(xml: string): PptxBox[] {
  if (!xml) return [];
  const out: PptxBox[] = [];
  for (const block of [...blocks(xml, "sp"), ...blocks(xml, "pic")]) {
    const xfrm = first(block, /<a:xfrm[\s\S]*?<\/a:xfrm>/i);
    const off = xfrm ? first(xfrm, /<a:off\b[^>]*>/i) : "";
    const ext = xfrm ? first(xfrm, /<a:ext\b[^>]*>/i) : "";
    const x = attr(off, "x");
    const y = attr(off, "y");
    const w = attr(ext, "cx");
    const h = attr(ext, "cy");
    if (w <= 0 || h <= 0) continue;
    const texts = xmlTexts(block);
    const pic = /<p:pic[\s>]/i.test(block) || /<p:blipFill/i.test(block);
    const sz = Number(attrMatch(block, /sz="(\d+)"/));
    out.push({
      x: inchesFromEmu(x),
      y: inchesFromEmu(y),
      w: inchesFromEmu(w),
      h: inchesFromEmu(h),
      kind: pic ? "picture" : texts.length ? "text" : "shape",
      text: texts.join("\n") || undefined,
      fontSize: sz ? sz / 100 : undefined,
      color: rgbOf(block),
      bold: /b="1"/.test(block),
      placeholder: attrMatch(block, /type="([^"]+)"/) || undefined,
      name: attrMatch(block, /name="([^"]+)"/) || undefined,
    });
  }
  return out;
}

function mergeLayout(slide: PptxBox[], layout: PptxBox[]): PptxBox[] {
  const pictures = layout.filter((box) => box.kind === "picture");
  const extras = pictures.filter(
    (pic) => !slide.some((s) => s.kind === "picture" && overlap(s, pic) > 0.6),
  );
  return [...extras, ...slide];
}

function inferLayout(boxes: PptxBox[]): SlideLayout {
  const ph = new Set(boxes.map((b) => b.placeholder).filter(Boolean));
  const pictures = boxes.filter((b) => b.kind === "picture");
  const texts = boxes.filter((b) => b.kind === "text" && (b.text ?? "").trim());
  if (ph.has("ctrTitle") || ph.has("title") && ph.has("subTitle")) return knownLayout("title-slide");
  if (ph.has("subTitle") && pictures.length) return knownLayout("title-slide");
  if (texts.length <= 1 && pictures.length && (texts[0]?.y ?? 0) > 5) return knownLayout("caption");
  if (pictures.length && (texts[0]?.y ?? 0) > 3.5) return knownLayout("section-header");
  const columns = twoColumns(boxes);
  if (columns) return knownLayout("title-and-two-columns");
  if (texts.some((t) => (t.fontSize ?? 0) >= 40 && /^\d/.test(t.text ?? ""))) return knownLayout("big-number");
  if (ph.has("body") && pictures.length) return knownLayout("section-title-and-description");
  if (ph.has("body")) return knownLayout("title-and-body");
  if (texts.length === 1) return knownLayout("main-point");
  return knownLayout("title-and-body");
}

function twoColumns(boxes: PptxBox[]): boolean {
  const body = boxes.filter((b) => b.kind === "text" && (b.y ?? 0) > 1.4 && (b.w ?? 0) < 7);
  if (body.length < 2) return false;
  const left = body.filter((b) => b.x < 6);
  const right = body.filter((b) => b.x >= 6);
  return left.length > 0 && right.length > 0;
}

function backgroundOf(
  slideXml: string,
  layoutXml: string,
  layoutRels: Map<string, string>,
): { fill?: string; picture?: boolean } | undefined {
  const fill = rgbOf(first(slideXml, /<p:bg[\s\S]*?<\/p:bg>/i) || first(layoutXml, /<p:bg[\s\S]*?<\/p:bg>/i));
  const picture = [...layoutRels.values()].some((t) => /\/media\//i.test(t)) || /<p:pic[\s>]/i.test(layoutXml);
  if (!fill && !picture) return undefined;
  return { fill, picture };
}

function overlap(a: PptxBox, b: PptxBox): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = Math.min(a.w * a.h, b.w * b.h);
  return area <= 0 ? 0 : (x * y) / area;
}

function sldSz(xml: string): { w: number; h: number } {
  const tag = first(xml, /<p:sldSz\b[^>]*>/i);
  return { w: inchesFromEmu(attr(tag, "cx")), h: inchesFromEmu(attr(tag, "cy")) };
}

async function coreTitle(zip: JSZip): Promise<string> {
  const xml = await readXml(zip, "docProps/core.xml");
  return xmlTexts(first(xml, /<dc:title[\s\S]*?<\/dc:title>/i)).join(" ").trim() || "Presentation";
}

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<p:${tag}[\\s>][\\s\\S]*?<\\/p:${tag}>`, "gi");
  for (const match of xml.matchAll(re)) out.push(match[0] ?? "");
  return out;
}

function xmlTexts(xml: string): string[] {
  const out: string[] = [];
  const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi;
  for (const match of xml.matchAll(re)) {
    const text = decode(match[1] ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function rgbOf(xml: string): string | undefined {
  const srgb = attrMatch(xml, /srgbClr[^>]*val="([0-9A-Fa-f]{6})"/);
  return srgb ? srgb.toUpperCase() : undefined;
}

function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<Relationship\b[^>]*>/gi;
  for (const match of xml.matchAll(re)) {
    const tag = match[0] ?? "";
    const id = attrMatch(tag, /\bId="([^"]+)"/);
    const target = attrMatch(tag, /Target="([^"]+)"/) || "";
    if (id && target) out.set(id, target);
  }
  return out;
}

function attr(tag: string, name: string): number {
  return Number(attrMatch(tag, new RegExp(`${name}="(-?\\d+)"`)) || 0);
}

function attrMatch(xml: string, re: RegExp): string {
  return xml.match(re)?.[1] ?? "";
}

function first(xml: string, re: RegExp): string {
  return xml.match(re)?.[0] ?? "";
}

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function readXml(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name) ?? zip.file(name.replace(/\\/g, "/"));
  if (!file) return "";
  return file.async("string");
}

function relsPath(file: string): string {
  const parts = file.split("/");
  const base = parts.pop() ?? "";
  return `${parts.join("/")}/_rels/${base}.rels`;
}

function resolvePpt(target: string): string {
  const n = norm(target);
  return n.startsWith("ppt/") ? n : `ppt/${n.replace(/^\.\//, "")}`;
}

function resolveFrom(from: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const dir = from.split("/").slice(0, -1);
  for (const part of target.replace(/\\/g, "/").split("/")) {
    if (part === "..") dir.pop();
    else if (part && part !== ".") dir.push(part);
  }
  return dir.join("/");
}

function norm(target: string): string {
  return target.replace(/\\/g, "/").replace(/^\//, "");
}

function slideNum(file: string): number {
  return Number(file.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

/** Two boxes that occupy the same space in the compiled file. */
export type PptxCollision = {
  slide: number;
  a: string;
  b: string;
  /** Square inches of intersection. */
  area: number;
};

/**
 * Ignore anything below this. Text frames carry internal padding, so boxes that
 * merely abut overlap by a hair without a reader ever seeing it. A tenth of a
 * square inch is far below "two titles on top of each other" and far above the
 * noise of adjacent cells.
 */
const COLLISION_FLOOR_SQIN = 0.1;

function area(a: PptxBox, b: PptxBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function label(box: PptxBox, index: number): string {
  const text = (box.text ?? "").trim().replace(/\s+/g, " ");
  if (text) return `"${text.slice(0, 32)}"`;
  return box.name || box.placeholder || `${box.kind} ${index}`;
}

/**
 * Text boxes that overlap in the file the reader opens.
 *
 * ## Why this is not the same check the planner already passes
 *
 * `validateLayout` reads the deck IR — the plan. This reads the compiled PPTX.
 * They disagree exactly when the compiler is at fault, and that is the case
 * nothing was catching: a deck passed structure with `overlap=0` while slide 2
 * shipped a main title and both column titles at the identical origin
 * (0.80, 0.85), three deep and unreadable. The plan was clean; the file was not.
 *
 * ## Text against text only
 *
 * Backgrounds and rules are supposed to sit under everything — a full-bleed
 * shape at (0,0) overlaps every box on the slide and always will. Comparing
 * pictures would flag every deliberate caption-over-image. What no design ever
 * wants is two pieces of text in the same place, so that is what is reported.
 */
export function textCollisions(deck: PptxDeckGeometry): PptxCollision[] {
  const found: PptxCollision[] = [];

  for (const slide of deck.slides) {
    const boxes = slide.boxes
      .map((box, index) => ({ box, index }))
      .filter(({ box }) => box.kind === "text" && box.w > 0 && box.h > 0);

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const overlap = area(boxes[i]!.box, boxes[j]!.box);
        if (overlap < COLLISION_FLOOR_SQIN) continue;
        found.push({
          slide: slide.index + 1,
          a: label(boxes[i]!.box, boxes[i]!.index),
          b: label(boxes[j]!.box, boxes[j]!.index),
          area: Math.round(overlap * 100) / 100,
        });
      }
    }
  }

  return found;
}
