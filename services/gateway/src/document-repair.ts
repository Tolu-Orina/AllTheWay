/**
 * Deterministic repair of named boxes. Does not regenerate the deck.
 *
 * Push overlapping pairs apart, snap to a 1/12" grid, clamp to margins,
 * shrink overflowing type toward 12pt. Coherence snap is code, not a VLM.
 */

import { SLIDE_H, SLIDE_W, type Box, type DeckIr, type SlideIr } from "./office-ir.js";
import { MARGIN_IN, overlapArea, type LayoutViolation } from "./document-validate.js";

export const GRID_IN = 1 / 12;
export const MIN_FONT_PT = 12;

export function repairLayout(deck: DeckIr, violations: LayoutViolation[]): { deck: DeckIr; changed: boolean } {
  if (!violations.length) return { deck, changed: false };
  const slides = deck.slides.map((slide) => ({
    ...slide,
    boxes: slide.boxes.map((box) => ({ ...box })),
    pictures: slide.pictures?.map((picture) => ({ ...picture })),
    shapes: slide.shapes?.map((shape) => ({ ...shape })),
    chart: slide.chart ? { ...slide.chart } : undefined,
  }));
  let changed = false;

  const bySlide = new Map<number, LayoutViolation[]>();
  for (const v of violations) {
    const list = bySlide.get(v.slideIndex) ?? [];
    list.push(v);
    bySlide.set(v.slideIndex, list);
  }

  for (const [index, list] of bySlide) {
    const slide = slides[index];
    if (!slide) continue;
    const overlaps = list.filter((v) => v.type === "overlap");
    if (overlaps.length) {
      changed = pushOverlaps(slide) || changed;
      changed = stackText(slide) || changed;
    }
    for (const v of list) {
      if (v.type === "overflow") {
        const box = slide.boxes.find((b) => (b.id || "") === v.elementId || `s${index}-${b.role}` === v.elementId);
        if (box && (box.fontSize ?? 18) > MIN_FONT_PT) {
          box.fontSize = Math.max(MIN_FONT_PT, (box.fontSize ?? 18) - 2);
          changed = true;
        }
      }
    }
    changed = snapSlide(slide) || changed;
  }

  return { deck: { ...deck, slides }, changed };
}

export function snapChrome(deck: DeckIr): DeckIr {
  const content = deck.slides.find(
    (slide) => slide.layout !== "title-slide" && slide.layout !== "section-header" && slide.layout !== "blank",
  );
  const title = content?.boxes.find((box) => box.role === "title");
  if (!title) return deck;
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      if (slide.layout === "title-slide" || slide.layout === "section-header" || slide.layout === "blank") {
        return slide;
      }
      return {
        ...slide,
        boxes: slide.boxes.map((box) => {
          if (box.role !== "title") return box;
          if (Math.abs(box.y - title.y) < 0.02 && Math.abs(box.x - title.x) < 0.02) return box;
          return { ...box, y: title.y, x: title.x };
        }),
      };
    }),
  };
}

function stackText(slide: SlideIr): boolean {
  const boxes = slide.boxes.filter((box) => !(box.role === "caption" && box.y < 0.4));
  if (boxes.length < 2) return false;
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  let changed = false;
  const gap = 0.08;
  let y = MARGIN_IN;
  for (const box of boxes) {
    if (box.y < y - 0.001) {
      box.y = y;
      changed = true;
    }
    const maxH = SLIDE_H - MARGIN_IN - box.y;
    if (box.h > maxH) {
      box.h = Math.max(0.2, maxH);
      changed = true;
    }
    y = box.y + box.h + gap;
  }
  return changed;
}

function pushOverlaps(slide: SlideIr): boolean {
  let changed = false;
  const movable: Array<{ box: Box; skip: boolean }> = [
    ...slide.boxes.map((box) => ({ box, skip: box.role === "caption" && box.y < 0.4 })),
    ...(slide.pictures ?? [])
      .filter((p) => p.role !== "background" && (p.w < SLIDE_W - 0.1 || p.h < SLIDE_H - 0.1))
      .map((box) => ({ box, skip: false })),
  ];
  for (let n = 0; n < 4; n++) {
    let moved = false;
    for (let i = 0; i < movable.length; i++) {
      for (let j = i + 1; j < movable.length; j++) {
        const a = movable[i]!;
        const b = movable[j]!;
        if (a.skip || b.skip) continue;
        const area = overlapArea(a.box, b.box);
        if (area <= 0.04) continue;
        pushPair(a.box, b.box);
        moved = true;
        changed = true;
      }
    }
    if (!moved) break;
  }
  return changed;
}

function pushPair(a: Box, b: Box): void {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return;
  if (ox <= oy) {
    const shift = ox / 2 + 0.05;
    if (a.x <= b.x) {
      a.x -= shift;
      b.x += shift;
    } else {
      a.x += shift;
      b.x -= shift;
    }
  } else {
    const shift = oy / 2 + 0.05;
    if (a.y <= b.y) {
      a.y -= shift;
      b.y += shift;
    } else {
      a.y += shift;
      b.y -= shift;
    }
  }
}

function snapSlide(slide: SlideIr): boolean {
  let changed = false;
  const snapBox = (box: Box, bleed: boolean): boolean => {
    const next = bleed ? clampCanvas(box) : clampMargin(snapGrid(box));
    if (next.x === box.x && next.y === box.y && next.w === box.w && next.h === box.h) return false;
    box.x = next.x;
    box.y = next.y;
    box.w = next.w;
    box.h = next.h;
    return true;
  };
  for (const box of slide.boxes) {
    if (snapBox(box, false)) changed = true;
  }
  for (const picture of slide.pictures ?? []) {
    const bleed = picture.role === "background" || (picture.w >= SLIDE_W - 0.1 && picture.h >= SLIDE_H - 0.1);
    if (snapBox(picture, bleed)) changed = true;
  }
  if (slide.chart && (slide.chart.x !== undefined || slide.chart.y !== undefined)) {
    const box = {
      x: slide.chart.x ?? 0.7,
      y: slide.chart.y ?? 1.6,
      w: slide.chart.w ?? 11.8,
      h: slide.chart.h ?? 5.2,
    };
    if (snapBox(box, false)) {
      slide.chart.x = box.x;
      slide.chart.y = box.y;
      slide.chart.w = box.w;
      slide.chart.h = box.h;
      changed = true;
    }
  }
  return changed;
}

function snapGrid(box: Box): Box {
  const snap = (n: number) => Math.round(n / GRID_IN) * GRID_IN;
  return { x: snap(box.x), y: snap(box.y), w: Math.max(0.3, snap(box.w)), h: Math.max(0.2, snap(box.h)) };
}

function clampMargin(box: Box): Box {
  const m = MARGIN_IN;
  const x = clamp(box.x, m, SLIDE_W - m - 0.3);
  const y = clamp(box.y, m, SLIDE_H - m - 0.2);
  return {
    x,
    y,
    w: clamp(box.w, 0.3, SLIDE_W - m - x),
    h: clamp(box.h, 0.2, SLIDE_H - m - y),
  };
}

function clampCanvas(box: Box): Box {
  const x = clamp(box.x, 0, SLIDE_W - 0.3);
  const y = clamp(box.y, 0, SLIDE_H - 0.2);
  return { x, y, w: clamp(box.w, 0.3, SLIDE_W - x), h: clamp(box.h, 0.2, SLIDE_H - y) };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
