/**
 * Default geometry for the eleven Office layouts.
 *
 * Used when a brief has no boxes (product orchestrator / tests).
 * A cell planner plan already has boxes — realizeDeck leaves those alone.
 */

import {
  SLIDE_H,
  SLIDE_W,
  type DeckIr,
  type Picture,
  type ShapeMark,
  type SlideIr,
  type TextBox,
} from "./office-ir.js";

const TEAL = "269683";
const CORAL = "E07A3D";
const INK = "111111";
const BODY = "5A5A5A";
const WHITE = "FFFFFF";
const MARGIN = 0.7;
const TITLE_PT = 32;
const BODY_PT = 18;
const SOURCE_PT = 12;

export function realizeDeck(deck: DeckIr): DeckIr {
  return {
    ...deck,
    slides: deck.slides.map((slide, index) => realizeSlide(slide, deck, index, deck.slides.length)),
  };
}

export function realizeSlide(slide: SlideIr, deck: DeckIr, index: number, total: number): SlideIr {
  if (slide.boxes.length > 0) {
    return attachLegacyPicture(slide, index);
  }
  return materialize(slide, deck, index, total);
}

function attachLegacyPicture(slide: SlideIr, index: number): SlideIr {
  if ((slide.pictures ?? []).length || slide.image?.kind !== "generate" || !slide.image.prompt?.trim()) {
    return slide;
  }
  return { ...slide, pictures: [legacyPicture(slide, index)] };
}

function materialize(slide: SlideIr, deck: DeckIr, index: number, total: number): SlideIr {
  const heading = slide.title || deck.title;
  const boxes: TextBox[] = [];
  const shapes: ShapeMark[] = [...(slide.shapes ?? [])];
  const pictures: Picture[] = [...(slide.pictures ?? [])];
  const date = deck.date || "";

  if (slide.layout === "title-slide") {
    chrome(boxes, deck.audience || "", date);
    hairline(shapes, MARGIN, 1.55, 1.9);
    if (slide.kicker) {
      boxes.push(text("kicker", slide.kicker.toUpperCase(), MARGIN, 1.2, 10, 0.28, SOURCE_PT, BODY));
    }
    boxes.push(text("title", heading, MARGIN, 1.85, 11.6, 1.35, 40, INK, true));
    if (slide.subtitle) {
      boxes.push(text("subtitle", slide.subtitle, MARGIN, 3.2, 11.6, 0.4, BODY_PT, BODY));
    }
    if (wantsPhoto(slide) && !pictures.length) {
      pictures.push(legacyPicture(slide, index, { x: 0, y: 3.55, w: SLIDE_W, h: 3.95, role: "picture" }));
    }
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  if (slide.layout === "section-header") {
    if (wantsPhoto(slide) && !pictures.length) {
      pictures.push(legacyPicture(slide, index, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, role: "background" }));
    }
    hairline(shapes, MARGIN, 4.35, 1.9);
    boxes.push(text("title", heading, MARGIN, 4.55, 11.5, 1.6, 40, WHITE, true));
    if (slide.bullets?.length) {
      boxes.push(text("subtitle", slide.bullets.slice(0, 2).join("  ·  "), MARGIN, 6.35, 11.5, 0.55, BODY_PT, WHITE));
    }
    return done(slide, boxes, shapes, pictures, { fill: "2B2B2B" });
  }

  if (slide.layout === "caption") {
    if (wantsPhoto(slide) && !pictures.length) {
      pictures.push(legacyPicture(slide, index, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, role: "background" }));
    }
    boxes.push(text("caption", heading, 0.5, 6.5, 8, 0.6, SOURCE_PT, WHITE));
    return done(slide, boxes, shapes, pictures, { fill: "2B2B2B" });
  }

  if (slide.layout === "main-point") {
    const fill = "2B2B2B";
    hairline(shapes, MARGIN, 2.15, 1.9);
    if (slide.kicker) {
      boxes.push(text("kicker", slide.kicker, MARGIN, 2.35, 11, 0.4, 20, WHITE, true));
    }
    boxes.push(text("title", slide.quote || heading, MARGIN, 2.9, 11.9, 3.2, 28, WHITE, true));
    return done(slide, boxes, shapes, pictures, { fill });
  }

  if (slide.layout === "blank") {
    if (wantsPhoto(slide) && !pictures.length) {
      pictures.push(legacyPicture(slide, index, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, role: "background" }));
    }
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  contentChrome(boxes, shapes, index, total);
  boxes.push(text("title", heading, MARGIN, 0.62, 11.9, 1.05, TITLE_PT, INK, true));

  if (slide.layout === "title-only") {
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  if (slide.layout === "big-number") {
    const items = (slide.metrics ?? []).slice(0, 4);
    const shown = items.length ? items : [{ label: "Metric", value: "—", detail: heading }];
    const n = shown.length;
    const colW = 11.9 / n;
    shown.forEach((metric, i) => {
      const x = MARGIN + i * colW;
      if (i > 0) {
        shapes.push({ kind: "line", x, y: 2.05, w: 0.01, h: 4.6, color: "E8E8E8" });
      }
      boxes.push(text("kicker", metric.label, x + 0.25, 2.2, colW - 0.5, 0.4, SOURCE_PT, TEAL));
      boxes.push(text("number", metric.value, x + 0.25, 2.7, colW - 0.5, 1.6, 48, TEAL, true));
      boxes.push(
        text(
          "body",
          [metric.detail, metric.owner].filter(Boolean).join(" · ") || metric.label,
          x + 0.25,
          4.5,
          colW - 0.5,
          2.1,
          BODY_PT,
          INK,
          true,
        ),
      );
    });
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  if (slide.layout === "title-and-two-columns") {
    const items = columnsOf(slide);
    const n = Math.max(1, Math.min(4, items.length));
    if (n <= 2) {
      const colW = 5.7;
      items.slice(0, 2).forEach((item, i) => {
        const x = MARGIN + i * (colW + 0.35);
        numbered(shapes, boxes, i + 1, x, 2.05);
        boxes.push(text("body", item.title, x + 0.78, 2.05, colW - 0.9, 0.7, 22, INK, true));
        if (item.body) {
          boxes.push(text("body", item.body, x + 0.78, 2.8, colW - 0.9, 4.1, BODY_PT, BODY));
        }
      });
    } else {
      const cols = 2;
      const cellW = 5.8;
      items.slice(0, 4).forEach((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = MARGIN + col * (cellW + 0.25);
        const y = 2.0 + row * 2.45;
        numbered(shapes, boxes, i + 1, x, y);
        boxes.push(text("body", item.title, x + 0.78, y, cellW - 0.9, item.body ? 0.55 : 2.0, BODY_PT, INK, true));
        if (item.body) {
          boxes.push(text("body", item.body, x + 0.78, y + 0.55, cellW - 0.9, 1.7, BODY_PT, BODY));
        }
      });
    }
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  if (slide.layout === "section-title-and-description") {
    const left = (slide.bullets ?? []).join("\n");
    boxes.push(text("body", left || heading, MARGIN, 1.9, 5.7, 4.6, BODY_PT, BODY));
    if (wantsPhoto(slide) && !pictures.length) {
      pictures.push(legacyPicture(slide, index, { x: 6.55, y: 1.85, w: 5.85, h: 4.55, role: "picture" }));
    }
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  if (slide.layout === "one-column-text") {
    const body = (slide.bullets ?? []).join("\n") || heading;
    boxes.push(text("body", body, MARGIN, 1.9, 5.5, 4.8, BODY_PT, BODY));
    if (wantsPhoto(slide) && !pictures.length) {
      pictures.push(legacyPicture(slide, index, { x: 6.7, y: 1.7, w: 5.9, h: 5.1, role: "picture" }));
    }
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  if (slide.chart) {
    slide.chart = {
      ...slide.chart,
      x: slide.chart.x ?? MARGIN,
      y: slide.chart.y ?? 1.95,
      w: slide.chart.w ?? 11.9,
      h: slide.chart.h ?? 4.85,
    };
    return done(slide, boxes, shapes, pictures, { fill: WHITE });
  }

  const bodyItems = slide.asks?.length ? slide.asks : slide.bullets ?? [];
  if (bodyItems.length) {
    boxes.push(text("body", bodyItems.join("\n"), MARGIN, 1.9, 11.9, 4.8, BODY_PT, BODY));
  }
  return done(slide, boxes, shapes, pictures, { fill: WHITE });
}

function done(
  slide: SlideIr,
  boxes: TextBox[],
  shapes: ShapeMark[],
  pictures: Picture[],
  background: { fill: string },
): SlideIr {
  return {
    ...slide,
    background: slide.background ?? background,
    boxes,
    shapes,
    pictures: pictures.length ? pictures : undefined,
  };
}

function columnsOf(slide: SlideIr): Array<{ title: string; body: string }> {
  if (slide.cards?.length) return slide.cards;
  if (slide.asks?.length) return slide.asks.map((ask) => ({ title: ask, body: "" }));
  return (slide.bullets ?? []).map((b) => ({ title: b, body: "" }));
}

function wantsPhoto(slide: SlideIr): boolean {
  return slide.image?.kind === "generate" && Boolean(slide.image.prompt?.trim());
}

function legacyPicture(
  slide: SlideIr,
  index: number,
  box: { x: number; y: number; w: number; h: number; role: Picture["role"] } = {
    x: 0,
    y: 3.55,
    w: SLIDE_W,
    h: 3.95,
    role: "picture",
  },
): Picture {
  return {
    id: `s${index}-image`,
    prompt: slide.image?.prompt?.trim() || "editorial photograph, no text",
    role: box.role,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
  };
}

function chrome(boxes: TextBox[], audience: string, date: string): void {
  boxes.push(text("caption", "Confidential", MARGIN, 0.22, 3.2, 0.28, SOURCE_PT, BODY));
  if (audience) {
    boxes.push({ ...text("caption", audience, 3.6, 0.22, 6.2, 0.28, SOURCE_PT, BODY), align: "center" });
  }
  if (date) {
    boxes.push({ ...text("caption", date, 10.1, 0.22, 2.5, 0.28, SOURCE_PT, BODY), align: "right" });
  }
}

function contentChrome(boxes: TextBox[], shapes: ShapeMark[], index: number, total: number): void {
  shapes.push({ kind: "rect", x: 0, y: 0, w: SLIDE_W, h: 0.28, fill: "E8E8E8" });
  boxes.push({
    ...text("caption", `${index + 1} / ${total}`, 10.4, 0.04, 2.5, 0.2, 10, BODY),
    align: "right",
  });
  hairline(shapes, MARGIN, 0.48, 1.55);
}

function hairline(shapes: ShapeMark[], x: number, y: number, w: number): void {
  shapes.push({ kind: "rect", x, y, w: w * 0.62, h: 0.035, fill: TEAL });
  shapes.push({ kind: "rect", x: x + w * 0.62, y, w: w * 0.38, h: 0.035, fill: CORAL });
}

function numbered(shapes: ShapeMark[], boxes: TextBox[], n: number, x: number, y: number): void {
  shapes.push({ kind: "ellipse", x, y, w: 0.58, h: 0.58, fill: TEAL });
  boxes.push({
    ...text("caption", String(n).padStart(2, "0"), x, y, 0.58, 0.58, 13, WHITE, true),
    align: "center",
    valign: "middle",
  });
}

function text(
  role: TextBox["role"],
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  color: string,
  bold = false,
): TextBox {
  return { role, text: value, x, y, w, h, fontSize, color, bold, align: "left", valign: "top" };
}
