/**
 * Deterministic layout checks on deck.v1 boxes. No raster, no VLM.
 *
 * Failures skip LibreOffice and the judge. Warnings go to the planner.
 * Story constraints stay in office-ir structuralIssues; this file owns
 * geometry (overlap, canvas, images, margins, imbalance, contrast).
 */

import {
  SLIDE_H,
  SLIDE_W,
  imageSlots,
  structuralIssues,
  type Box,
  type DeckIr,
  type Picture,
  type ShapeMark,
  type SlideIr,
} from "./office-ir.js";
import type { SlideImages } from "./office-slides.js";
import type { StillCache } from "./document-images.js";
import { promptHash } from "./document-images.js";

export const MARGIN_IN = 0.45;
export const OVERLAP_FAIL_IN2 = 0.04;

export type LayoutViolationType =
  | "overlap"
  | "off-canvas"
  | "missing-image"
  | "margin"
  | "imbalance"
  | "contrast"
  | "overflow"
  | "tiny-box"
  | "story";

export type LayoutViolation = {
  elementId: string;
  type: LayoutViolationType;
  magnitude: number;
  slideIndex: number;
  note: string;
  severity: "fail" | "warn";
};

export type LayoutReport = {
  ok: boolean;
  failures: LayoutViolation[];
  warnings: LayoutViolation[];
  overlapCount: number;
  offCanvasCount: number;
};

type LayoutEl = Box & {
  id: string;
  slideIndex: number;
  kind: "text" | "picture" | "chart" | "shape";
  skipOverlap: boolean;
  fullBleed: boolean;
  fontSize?: number;
  text?: string;
  color?: string;
  fill?: string;
};

export function validateLayout(
  deck: DeckIr,
  images?: SlideImages,
  stills?: StillCache,
  requireStills = false,
): LayoutReport {
  const failures: LayoutViolation[] = [];
  const warnings: LayoutViolation[] = [];

  for (const note of structuralIssues(deck)) {
    failures.push({
      elementId: "deck",
      type: "story",
      magnitude: 1,
      slideIndex: 0,
      note,
      severity: "fail",
    });
  }

  deck.slides.forEach((slide, slideIndex) => {
    const els = elementsOf(slide, slideIndex);
    for (const el of els) {
      if (el.x < -0.02 || el.y < -0.02 || el.x + el.w > SLIDE_W + 0.02 || el.y + el.h > SLIDE_H + 0.02) {
        failures.push({
          elementId: el.id,
          type: "off-canvas",
          magnitude: Math.max(-el.x, -el.y, el.x + el.w - SLIDE_W, el.y + el.h - SLIDE_H),
          slideIndex,
          note: `slide ${slideIndex + 1}: ${el.id} is off-canvas`,
          severity: "fail",
        });
      }
      if (!el.fullBleed && !el.skipOverlap) {
        const m = MARGIN_IN;
        if (el.x < m - 0.05 || el.y < m - 0.05 || el.x + el.w > SLIDE_W - m + 0.05 || el.y + el.h > SLIDE_H - m + 0.05) {
          warnings.push({
            elementId: el.id,
            type: "margin",
            magnitude: Math.min(el.x, el.y, SLIDE_W - (el.x + el.w), SLIDE_H - (el.y + el.h)),
            slideIndex,
            note: `slide ${slideIndex + 1}: ${el.id} sits inside the ${m}in margin`,
            severity: "warn",
          });
        }
      }
      if (el.kind === "text" && el.text && el.fontSize) {
        const overflow = overflowAmount(el);
        if (overflow > 0.15) {
          warnings.push({
            elementId: el.id,
            type: "overflow",
            magnitude: overflow,
            slideIndex,
            note: `slide ${slideIndex + 1}: ${el.id} type overflows the box`,
            severity: "warn",
          });
        }
      }
    }

    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        if (a.skipOverlap || b.skipOverlap) continue;
        if (a.fullBleed || b.fullBleed) continue;
        if (isAncestor(a, b) || isAncestor(b, a)) continue;
        const area = overlapArea(a, b);
        if (area <= OVERLAP_FAIL_IN2) continue;
        failures.push({
          elementId: a.id,
          type: "overlap",
          magnitude: area,
          slideIndex,
          note: `slide ${slideIndex + 1}: ${a.id} overlaps ${b.id} (${area.toFixed(2)}in²)`,
          severity: "fail",
        });
      }
    }

    const content = els.filter((el) => el.kind === "text" || (el.kind === "picture" && !el.fullBleed));
    if (content.length >= 2) {
      const cx = content.reduce((s, el) => s + el.x + el.w / 2, 0) / content.length;
      const cy = content.reduce((s, el) => s + el.y + el.h / 2, 0) / content.length;
      const dx = Math.abs(cx - SLIDE_W / 2) / SLIDE_W;
      const dy = Math.abs(cy - SLIDE_H / 2) / SLIDE_H;
      if (dx > 0.05 || dy > 0.15) {
        warnings.push({
          elementId: `s${slideIndex}`,
          type: "imbalance",
          magnitude: Math.max(dx, dy),
          slideIndex,
          note: `slide ${slideIndex + 1}: content centroid is off-balance`,
          severity: "warn",
        });
      }
    }

    const fill = luminanceOfHex(slide.background?.fill) ?? 255;
    for (const el of els) {
      if (el.kind !== "text" || !el.color) continue;
      const textLum = luminanceOfHex(el.color);
      if (textLum === undefined) continue;
      let bg = fill;
      const under = els.find((p) => el !== p && p.kind === "picture" && containsBox(p, el, 0.05));
      if (under && stills) {
        const pic = (slide.pictures ?? []).find((p) => p.id === under.id);
        const asset = pic ? stills.get(promptHash(pic.prompt)) : undefined;
        if (asset) bg = asset.luminance;
      }
      if (contrastRatio(textLum, bg) < 3) {
        warnings.push({
          elementId: el.id,
          type: "contrast",
          magnitude: contrastRatio(textLum, bg),
          slideIndex,
          note: `slide ${slideIndex + 1}: ${el.id} contrast is below 3:1`,
          severity: "warn",
        });
      }
    }
  });

  if (requireStills) {
    for (const slot of imageSlots(deck)) {
      const hasBytes = Boolean(images?.[slot.id]?.length);
      const hasStill = Boolean(stills?.get(promptHash(slot.prompt))?.bytes.length);
      if (!hasBytes && !hasStill) {
        failures.push({
          elementId: slot.id,
          type: "missing-image",
          magnitude: 1,
          slideIndex: 0,
          note: `planned still ${slot.id} has no image`,
          severity: "fail",
        });
      }
    }
  }

  const overlapCount = failures.filter((v) => v.type === "overlap").length;
  const offCanvasCount = failures.filter((v) => v.type === "off-canvas").length;
  return {
    ok: failures.length === 0,
    failures,
    warnings,
    overlapCount,
    offCanvasCount,
  };
}

export function overlapArea(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

export function violationNotes(report: LayoutReport): string[] {
  return [...report.failures, ...report.warnings].map((v) => v.note).slice(0, 24);
}

function elementsOf(slide: SlideIr, slideIndex: number): LayoutEl[] {
  const out: LayoutEl[] = [];
  slide.boxes.forEach((box, i) => {
    out.push({
      ...box,
      id: box.id || `s${slideIndex}-${box.role}-${i}`,
      slideIndex,
      kind: "text",
      skipOverlap: box.role === "caption" && box.y < 0.4,
      fullBleed: isFullBleed(box),
      fontSize: box.fontSize,
      text: box.text,
      color: box.color,
    });
  });
  (slide.pictures ?? []).forEach((picture, i) => {
    out.push(pictureEl(picture, slideIndex, i));
  });
  if (slide.chart) {
    const c = slide.chart;
    out.push({
      id: `s${slideIndex}-chart`,
      slideIndex,
      kind: "chart",
      x: c.x ?? 0.7,
      y: c.y ?? 1.6,
      w: c.w ?? 11.8,
      h: c.h ?? 5.2,
      skipOverlap: false,
      fullBleed: false,
    });
  }
  (slide.shapes ?? []).forEach((shape, i) => {
    out.push(shapeEl(shape, slideIndex, i));
  });
  return out;
}

function pictureEl(picture: Picture, slideIndex: number, i: number): LayoutEl {
  const fullBleed = isFullBleed(picture) || picture.role === "background";
  return {
    ...picture,
    id: picture.id || `s${slideIndex}-pic-${i}`,
    slideIndex,
    kind: "picture",
    skipOverlap: fullBleed,
    fullBleed,
  };
}

function shapeEl(shape: ShapeMark, slideIndex: number, i: number): LayoutEl {
  const hairline = shape.h < 0.08 || shape.w < 0.08;
  const chrome = shape.y < 0.35 && shape.h < 0.4;
  return {
    ...shape,
    id: `s${slideIndex}-shape-${i}`,
    slideIndex,
    kind: "shape",
    skipOverlap: hairline || chrome || Boolean(shape.fill && isFullBleed(shape)),
    fullBleed: isFullBleed(shape),
    fill: shape.fill,
  };
}

function isFullBleed(box: Box): boolean {
  return box.w >= SLIDE_W - 0.08 && box.h >= SLIDE_H - 0.08;
}

function isAncestor(outer: LayoutEl, inner: LayoutEl): boolean {
  if (outer.kind === "text" && inner.kind === "text") return false;
  return containsBox(outer, inner, 0.04);
}

function containsBox(outer: Box, inner: Box, pad: number): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.w <= outer.x + outer.w + pad &&
    inner.y + inner.h <= outer.y + outer.h + pad
  );
}

function overflowAmount(el: LayoutEl): number {
  const pt = el.fontSize ?? 18;
  const lineH = (pt / 72) * 1.2;
  const cols = Math.max(1, Math.floor(el.h / lineH));
  const charW = (pt / 72) * 0.52;
  const capacity = Math.max(1, (el.w / charW) * cols);
  const chars = (el.text ?? "").length;
  return Math.max(0, chars / capacity - 1);
}

function luminanceOfHex(hex?: string): number | undefined {
  if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return undefined;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) * 255;
}

function contrastRatio(a: number, b: number): number {
  const l1 = a / 255 + 0.05;
  const l2 = b / 255 + 0.05;
  return Math.max(l1, l2) / Math.min(l1, l2);
}
