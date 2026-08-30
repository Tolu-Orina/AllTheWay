import PptxGenJS from "pptxgenjs";

import { realizeDeck } from "./office-layouts.js";
import {
  SLIDE_H,
  SLIDE_W,
  type ChartSpec,
  type DeckIr,
  type Picture,
  type ShapeMark,
  type SlideIr,
  type TextBox,
  parseDeck,
} from "./office-ir.js";
import { MIME_SLIDES } from "./office-mime.js";

/**
 * Worker. Paints the planner’s boxes, shapes, and pictures literally.
 * Does not invent coordinates.
 */

type OfficeFile = {
  title: string;
  mimeType: string;
  body: Buffer;
  prompt: string;
};

type Page = ReturnType<PptxGenJS["addSlide"]>;

const FONT = "Calibri";
const TEAL = "269683";
const CORAL = "E07A3D";
const WHITE = "FFFFFF";

export type SlideImages = Record<string, Buffer>;

export async function slidesBytes(
  args: Record<string, unknown>,
  images: SlideImages = {},
): Promise<OfficeFile> {
  return compileDeck(parseDeck(args), images);
}

export async function compileDeck(deck: DeckIr, images: SlideImages = {}): Promise<OfficeFile> {
  const planned = realizeDeck(deck);
  const pptx = new PptxGenJS();
  pptx.author = "AllTheWay";
  pptx.title = planned.title;
  pptx.defineLayout({ name: "ATW", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "ATW";

  planned.slides.forEach((slide) => paintSlide(pptx, planned, slide, images));

  const packed = await pptx.write({ outputType: "nodebuffer" });
  return {
    title: planned.title,
    mimeType: MIME_SLIDES,
    body: Buffer.from(packed as Buffer),
    prompt: `PowerPoint: ${planned.title}`,
  };
}

function paintSlide(pptx: PptxGenJS, deck: DeckIr, slide: SlideIr, images: SlideImages): void {
  const page = pptx.addSlide();
  const fill = slide.background?.fill || deck.background?.fill || WHITE;
  page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: fill } });

  const bgId = slide.background?.image?.id || deck.background?.image?.id;
  const bgBytes = bgId ? images[bgId] : undefined;
  if (bgBytes?.length) {
    page.addImage({ data: imageDataUri(bgBytes), x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
  }

  const pictures = slide.pictures ?? [];
  for (const picture of pictures.filter((p) => p.role === "background")) {
    blitPicture(page, picture, images);
  }
  for (const picture of pictures.filter((p) => p.role !== "background")) {
    blitPicture(page, picture, images);
  }

  for (const shape of slide.shapes ?? []) paintShape(pptx, page, shape);
  for (const box of slide.boxes) paintText(page, box);
  if (slide.chart) paintChart(pptx, page, slide.chart);
}

function blitPicture(page: Page, picture: Picture, images: SlideImages): void {
  const bytes = images[picture.id];
  if (!bytes?.length) return;
  page.addImage({
    data: imageDataUri(bytes),
    x: picture.x,
    y: picture.y,
    w: picture.w,
    h: picture.h,
  });
}

function paintShape(pptx: PptxGenJS, page: Page, shape: ShapeMark): void {
  const fill = shape.fill ? { color: shape.fill } : undefined;
  const line = shape.color ? { color: shape.color, width: 1.25 } : undefined;
  if (shape.kind === "ellipse") {
    page.addShape(pptx.ShapeType.ellipse, { x: shape.x, y: shape.y, w: shape.w, h: shape.h, fill });
    return;
  }
  if (shape.kind === "line") {
    page.addShape(pptx.ShapeType.line, {
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      line: line ?? { color: "E8E8E8", width: 1.25 },
    });
    return;
  }
  page.addShape(pptx.ShapeType.rect, { x: shape.x, y: shape.y, w: shape.w, h: shape.h, fill, line });
}

function paintText(page: Page, box: TextBox): void {
  const lines = box.text.split("\n").filter((line) => line.length);
  page.addText(
    lines.length > 1 ? lines.map((line) => ({ text: line, options: { breakLine: true } })) : box.text,
    {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontFace: FONT,
      fontSize: box.fontSize ?? (box.role === "title" ? 32 : box.role === "number" ? 48 : 18),
      bold: Boolean(box.bold),
      color: box.color || "111111",
      align: box.align ?? "left",
      valign: box.valign ?? "top",
      margin: 0,
      paraSpaceAfter: box.role === "body" && lines.length > 1 ? 10 : 0,
    },
  );
}

function paintChart(pptx: PptxGenJS, page: Page, chart: ChartSpec): void {
  const type =
    chart.type === "line" ? pptx.ChartType.line : chart.type === "pie" ? pptx.ChartType.pie : pptx.ChartType.bar;
  const series = chart.series.map((s) => ({
    name: s.name,
    labels: chart.categories,
    values: s.values,
  }));
  page.addChart(type, series, {
    x: chart.x ?? 0.7,
    y: chart.y ?? 1.95,
    w: chart.w ?? 11.9,
    h: chart.h ?? 4.85,
    showLegend: true,
    showValue: true,
    chartColors: [TEAL, CORAL, TEAL],
  });
}

function imageDataUri(bytes: Buffer): string {
  const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  return `image/${jpeg ? "jpeg" : "png"};base64,${bytes.toString("base64")}`;
}
