import PptxGenJS from "pptxgenjs";

import { type DeckIr, type SlideIr, parseDeck } from "./office-ir.js";
import { MIME_SLIDES } from "./office-mime.js";
import { bleedSectionStill } from "./document-raster.js";

/**
 * Deck compiler. Geometry is locked here — the critic never places x/y.
 *
 * Grid from the consulting-proposal sample plus research floors:
 * 0.7in left (above the 0.5in floor), Calibri, 32pt titles / 18pt body /
 * 12pt sources, 2–4 supports, teal/coral hairline.
 */

type OfficeFile = {
  title: string;
  mimeType: string;
  body: Buffer;
  prompt: string;
};

type Page = ReturnType<PptxGenJS["addSlide"]>;

const TEAL = "269683";
const CORAL = "E07A3D";
const INK = "111111";
const BODY = "5A5A5A";
const CHARCOAL = "2B2B2B";
const BAR = "E8E8E8";
const WHITE = "FFFFFF";
const FONT = "Calibri";
const W = 13.333;
const H = 7.5;
const MARGIN = 0.7;
const TITLE_PT = 32;
const BODY_PT = 18;
const SOURCE_PT = 12;
const COVER_TITLE_PT = 40;
const METRIC_PT = 48;
const PHOTO_Y = 3.55;
const PHOTO_H = 3.95;

export type SlideImages = Record<number, Buffer>;

export async function slidesBytes(
  args: Record<string, unknown>,
  images: SlideImages = {},
): Promise<OfficeFile> {
  return compileDeck(parseDeck(args), images);
}

export async function compileDeck(deck: DeckIr, images: SlideImages = {}): Promise<OfficeFile> {
  const pptx = new PptxGenJS();
  pptx.author = "AllTheWay";
  pptx.title = deck.title;
  pptx.defineLayout({ name: "ATW", width: W, height: H });
  pptx.layout = "ATW";

  const audience = deck.audience ?? "";
  const date = deck.date || todayUk();
  const slides = deck.slides;
  slides.forEach((slide, i) => {
    paintSlide(pptx, slide, i, slides.length, deck.title, audience, date, images[i]);
  });

  const packed = await pptx.write({ outputType: "nodebuffer" });
  return {
    title: deck.title,
    mimeType: MIME_SLIDES,
    body: Buffer.from(packed as Buffer),
    prompt: `PowerPoint: ${deck.title}`,
  };
}

function paintSlide(
  pptx: PptxGenJS,
  slide: SlideIr,
  index: number,
  total: number,
  deckTitle: string,
  audience: string,
  date: string,
  image?: Buffer,
): void {
  const heading = slide.title || deckTitle;

  if (slide.layout === "title") {
    titleSlide(pptx, heading, slide.kicker || "Briefing", slide.subtitle || "", audience, date, image);
    return;
  }
  if (slide.layout === "photo-story") {
    sectionPhoto(pptx, heading, slide.bullets ?? [], image);
    return;
  }
  if (slide.layout === "quote") {
    charcoalSlide(pptx, slide.kicker || heading, slide.quote || heading);
    return;
  }
  if (slide.layout === "agenda") {
    tealAgenda(pptx, heading, slide.bullets?.length ? slide.bullets : slide.asks ?? []);
    return;
  }
  if (slide.layout === "closing-ask" && image?.length) {
    thanksSlide(pptx, heading, slide.asks?.length ? slide.asks : slide.bullets ?? [], image);
    return;
  }

  const page = contentFrame(pptx, index, total);
  const split = slide.layout === "split-visual";
  headingBlock(pptx, page, heading, split ? undefined : slide.subtitle, split ? 6.2 : 7.6);

  if (slide.layout === "two-card") {
    problemGrid(
      pptx,
      page,
      (slide.cards ?? []).map((c) => ({ title: c.title, body: c.body })),
    );
    return;
  }
  if (slide.layout === "metric-row") {
    metrics(pptx, page, slide.metrics ?? []);
    return;
  }
  if (slide.layout === "split-visual") {
    splitVisual(pptx, page, slide.bullets ?? [], image);
    return;
  }
  if (slide.layout === "chart" && slide.chart) {
    addChart(pptx, page, slide.chart);
    return;
  }
  if (slide.layout === "closing-ask") {
    problemGrid(
      pptx,
      page,
      (slide.asks?.length ? slide.asks : slide.bullets ?? []).map((ask) => ({ title: ask, body: "" })),
    );
    return;
  }
  const bullets = slide.bullets ?? [];
  if (bullets.length) {
    problemGrid(
      pptx,
      page,
      bullets.map((b) => ({ title: b, body: "" })),
    );
  }
}

function accentLine(pptx: PptxGenJS, page: Page, x: number, y: number, w = 1.55): void {
  page.addShape(pptx.ShapeType.rect, { x, y, w: w * 0.62, h: 0.035, fill: { color: TEAL } });
  page.addShape(pptx.ShapeType.rect, {
    x: x + w * 0.62,
    y,
    w: w * 0.38,
    h: 0.035,
    fill: { color: CORAL },
  });
}

function titleSlide(
  pptx: PptxGenJS,
  title: string,
  kicker: string,
  subtitle: string,
  audience: string,
  date: string,
  image?: Buffer,
): void {
  const page = pptx.addSlide();
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: WHITE } });
  if (image && image.length) {
    page.addImage({ data: imageDataUri(image), x: 0, y: PHOTO_Y, w: W, h: PHOTO_H });
  }
  page.addText("Confidential", {
    x: MARGIN,
    y: 0.22,
    w: 3.2,
    h: 0.28,
    fontFace: FONT,
    fontSize: SOURCE_PT,
    color: BODY,
    margin: 0,
  });
  page.addText(audience || "", {
    x: 3.6,
    y: 0.22,
    w: 6.2,
    h: 0.28,
    fontFace: FONT,
    fontSize: SOURCE_PT,
    align: "center",
    color: BODY,
    margin: 0,
  });
  page.addText(date, {
    x: 10.1,
    y: 0.22,
    w: 2.5,
    h: 0.28,
    fontFace: FONT,
    fontSize: SOURCE_PT,
    align: "right",
    color: BODY,
    margin: 0,
  });
  accentLine(pptx, page, MARGIN, 1.55, 1.9);
  page.addText(kicker.toUpperCase(), {
    x: MARGIN,
    y: 1.2,
    w: 10,
    h: 0.28,
    fontFace: FONT,
    fontSize: SOURCE_PT,
    color: BODY,
    margin: 0,
  });
  page.addText(title, {
    x: MARGIN,
    y: 1.85,
    w: 11.6,
    h: 1.35,
    fontFace: FONT,
    fontSize: COVER_TITLE_PT,
    bold: true,
    color: INK,
    valign: "top",
    margin: 0,
  });
  if (subtitle) {
    page.addText(subtitle, {
      x: MARGIN,
      y: 3.2,
      w: 11.6,
      h: 0.32,
      fontFace: FONT,
      fontSize: BODY_PT,
      color: BODY,
      margin: 0,
    });
  }
}

function contentFrame(pptx: PptxGenJS, index: number, total: number): Page {
  const page = pptx.addSlide();
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: WHITE } });
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.28, fill: { color: BAR } });
  page.addText(`${index + 1} / ${total}`, {
    x: 10.4,
    y: 0.04,
    w: 2.5,
    h: 0.2,
    fontFace: FONT,
    fontSize: 10,
    align: "right",
    color: BODY,
    margin: 0,
  });
  return page;
}

function headingBlock(
  pptx: PptxGenJS,
  page: Page,
  title: string,
  subtitle: string | undefined,
  titleW: number,
): void {
  accentLine(pptx, page, MARGIN, 0.48);
  page.addText(title, {
    x: MARGIN,
    y: 0.62,
    w: titleW,
    h: 1.15,
    fontFace: FONT,
    fontSize: TITLE_PT,
    bold: true,
    color: INK,
    valign: "top",
    margin: 0,
  });
  if (subtitle) {
    page.addText(subtitle, {
      x: 8.2,
      y: 0.7,
      w: 4.5,
      h: 1.15,
      fontFace: FONT,
      fontSize: 13,
      color: BODY,
      valign: "top",
      margin: 0,
    });
  }
}

function sectionPhoto(pptx: PptxGenJS, title: string, bullets: string[], image?: Buffer): void {
  const page = pptx.addSlide();
  if (image && image.length) {
    page.addImage({ data: imageDataUri(bleedSectionStill(image)), x: 0, y: 0, w: W, h: H });
  } else {
    page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: CHARCOAL } });
  }
  accentLine(pptx, page, MARGIN, 4.35, 1.9);
  page.addText(title, {
    x: MARGIN,
    y: 4.55,
    w: 11.5,
    h: 1.6,
    fontFace: FONT,
    fontSize: COVER_TITLE_PT,
    bold: true,
    color: WHITE,
    valign: "top",
    margin: 0,
  });
  if (bullets.length) {
    page.addText(bullets.slice(0, 2).join("  ·  "), {
      x: MARGIN,
      y: 6.35,
      w: 11.5,
      h: 0.55,
      fontFace: FONT,
      fontSize: BODY_PT,
      color: WHITE,
      margin: 0,
    });
  }
}

function thanksSlide(pptx: PptxGenJS, title: string, asks: string[], image: Buffer): void {
  const page = pptx.addSlide();
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: WHITE } });
  page.addImage({ data: imageDataUri(image), x: 0, y: PHOTO_Y, w: W, h: PHOTO_H });
  accentLine(pptx, page, MARGIN, 1.15, 1.9);
  page.addText(title, {
    x: MARGIN,
    y: 1.4,
    w: 11.6,
    h: 1.6,
    fontFace: FONT,
    fontSize: 36,
    bold: true,
    color: INK,
    valign: "top",
    margin: 0,
  });
  if (asks.length) {
    page.addText(asks[0] ?? "", {
      x: MARGIN,
      y: 3.05,
      w: 11.6,
      h: 0.4,
      fontFace: FONT,
      fontSize: BODY_PT,
      color: BODY,
      margin: 0,
    });
  }
}

function charcoalSlide(pptx: PptxGenJS, kicker: string, body: string): void {
  const page = pptx.addSlide();
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: CHARCOAL } });
  accentLine(pptx, page, MARGIN, 1.55, 1.9);
  page.addText(kicker, {
    x: MARGIN,
    y: 1.75,
    w: 11,
    h: 0.5,
    fontFace: FONT,
    fontSize: 20,
    bold: true,
    color: WHITE,
    margin: 0,
  });
  page.addText(body, {
    x: MARGIN,
    y: 2.45,
    w: 11,
    h: 3.6,
    fontFace: FONT,
    fontSize: 28,
    color: WHITE,
    valign: "top",
    margin: 0,
  });
}

function tealAgenda(pptx: PptxGenJS, title: string, items: string[]): void {
  const page = pptx.addSlide();
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: TEAL } });
  page.addText(title, {
    x: MARGIN,
    y: MARGIN,
    w: 11,
    h: 1.1,
    fontFace: FONT,
    fontSize: COVER_TITLE_PT,
    bold: true,
    color: WHITE,
    margin: 0,
  });
  const cols = 3;
  const colW = 3.7;
  items.slice(0, 12).forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    page.addText(item, {
      x: MARGIN + col * colW,
      y: 2.2 + row * 0.7,
      w: colW - 0.3,
      h: 0.55,
      fontFace: FONT,
      fontSize: BODY_PT,
      color: WHITE,
      margin: 0,
    });
  });
}

function problemGrid(pptx: PptxGenJS, page: Page, items: Array<{ title: string; body: string }>): void {
  const shown = items.slice(0, 4);
  if (shown.length <= 2) {
    shown.forEach((item, i) => {
      const y = 2.15 + i * 2.25;
      numberedDot(pptx, page, i + 1, MARGIN, y);
      page.addText(item.title, {
        x: 1.55,
        y,
        w: 11.1,
        h: 0.6,
        fontFace: FONT,
        fontSize: 22,
        bold: true,
        color: INK,
        valign: "top",
        margin: 0,
      });
      if (item.body) {
        page.addText(item.body, {
          x: 1.55,
          y: y + 0.65,
          w: 11.1,
          h: 1.3,
          fontFace: FONT,
          fontSize: BODY_PT,
          color: BODY,
          valign: "top",
          margin: 0,
        });
      }
    });
    return;
  }
  const cols = shown.length === 3 ? 3 : 2;
  const cellW = cols === 3 ? 3.9 : 5.85;
  shown.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cellW + 0.25);
    const y = 2.05 + row * 2.35;
    numberedDot(pptx, page, i + 1, x, y);
    page.addText(item.title, {
      x: x + 0.78,
      y,
      w: cellW - 0.85,
      h: item.body ? 0.55 : 1.7,
      fontFace: FONT,
      fontSize: BODY_PT,
      bold: true,
      color: INK,
      valign: "top",
      margin: 0,
    });
    if (item.body) {
      page.addText(item.body, {
        x: x + 0.78,
        y: y + 0.55,
        w: cellW - 0.85,
        h: 1.55,
        fontFace: FONT,
        fontSize: BODY_PT,
        color: BODY,
        valign: "top",
        margin: 0,
      });
    }
  });
}

function metrics(
  pptx: PptxGenJS,
  page: Page,
  items: Array<{ label: string; value: string; owner?: string; detail?: string }>,
): void {
  const n = Math.max(1, Math.min(3, items.length || 1));
  const w = 11.9 / n;
  const shown = (items.length ? items : [{ label: "Metric", value: "—" }]).slice(0, n);
  shown.forEach((m, i) => {
    const x = MARGIN + i * w;
    if (i > 0) {
      page.addShape(pptx.ShapeType.line, {
        x,
        y: 2.15,
        w: 0,
        h: 4.3,
        line: { color: BAR, width: 1.25, dashType: "dash" },
      });
    }
    page.addText(m.label, {
      x: x + 0.35,
      y: 2.25,
      w: w - 0.6,
      h: 0.4,
      fontFace: FONT,
      fontSize: SOURCE_PT,
      color: TEAL,
      margin: 0,
    });
    page.addText(m.value, {
      x: x + 0.35,
      y: 2.7,
      w: w - 0.6,
      h: 1.35,
      fontFace: FONT,
      fontSize: METRIC_PT,
      bold: true,
      color: TEAL,
      margin: 0,
    });
    const note = [m.detail, m.owner].filter(Boolean).join(" · ");
    page.addText(note || m.label, {
      x: x + 0.35,
      y: 4.2,
      w: w - 0.6,
      h: 1.8,
      fontFace: FONT,
      fontSize: BODY_PT,
      bold: true,
      color: INK,
      valign: "top",
      margin: 0,
    });
  });
}

function splitVisual(pptx: PptxGenJS, page: Page, bullets: string[], image?: Buffer): void {
  const body = bullets.filter((b) => !/^source:/i.test(b.trim()));
  const sources = bullets.filter((b) => /^source:/i.test(b.trim()));
  if (body.length) {
    page.addText(
      body.map((b) => ({ text: b, options: { breakLine: true } })),
      {
        x: MARGIN,
        y: 2.0,
        w: 5.7,
        h: 4.4,
        fontFace: FONT,
        fontSize: BODY_PT,
        color: BODY,
        valign: "top",
        paraSpaceAfter: 12,
      },
    );
  }
  if (sources.length) {
    page.addText(sources.join("  ·  "), {
      x: MARGIN,
      y: 6.55,
      w: 5.7,
      h: 0.4,
      fontFace: FONT,
      fontSize: SOURCE_PT,
      color: BODY,
      margin: 0,
    });
  }
  page.addShape(pptx.ShapeType.rect, { x: 9.15, y: 4.55, w: 3.7, h: 2.5, fill: { color: TEAL } });
  if (image && image.length) {
    page.addImage({
      data: imageDataUri(image),
      x: 6.55,
      y: 1.85,
      w: 5.85,
      h: 4.55,
    });
  }
}

function numberedDot(pptx: PptxGenJS, page: Page, n: number, x: number, y: number): void {
  page.addShape(pptx.ShapeType.ellipse, {
    x,
    y,
    w: 0.58,
    h: 0.58,
    fill: { color: TEAL },
  });
  page.addText(String(n).padStart(2, "0"), {
    x,
    y,
    w: 0.58,
    h: 0.58,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: WHITE,
    align: "center",
    valign: "middle",
    margin: 0,
  });
}

function imageDataUri(bytes: Buffer): string {
  const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  return `image/${jpeg ? "jpeg" : "png"};base64,${bytes.toString("base64")}`;
}

function addChart(pptx: PptxGenJS, page: Page, chart: NonNullable<SlideIr["chart"]>): void {
  const type =
    chart.type === "line" ? pptx.ChartType.line : chart.type === "pie" ? pptx.ChartType.pie : pptx.ChartType.bar;
  const series = chart.series.map((s) => ({
    name: s.name,
    labels: chart.categories,
    values: s.values,
  }));
  page.addChart(type, series, {
    x: MARGIN,
    y: 2.05,
    w: 12.0,
    h: 4.85,
    showLegend: true,
    showValue: true,
    chartColors: [TEAL, CORAL, TEAL],
  });
}

function todayUk(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
