import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { parseReport, reportToMarkdown } from "./office-ir.js";

/**
 * Designed PDF generation. A4, Helvetica (universally present), AllTheWay navy.
 * Same planner contract as Word: title once, markdown body, tables, labelled
 * bullets. Not a Microsoft 365 connector and not a scanned dump.
 */

export const MIME_PDF = "application/pdf";

type OfficeFile = {
  title: string;
  mimeType: string;
  body: Buffer;
  prompt: string;
};

const NAVY = rgb(0.008, 0.141, 0.471);
const BLUE = rgb(0.008, 0.412, 0.902);
const INK = rgb(0.043, 0.082, 0.2);
const MUTED = rgb(0.353, 0.404, 0.522);
const RULE = rgb(0.863, 0.89, 0.949);
const WASH = rgb(0.953, 0.965, 0.992);

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 54;
/** Chrome lives in these bands. Content must never draw here. */
const HEADER_BAND = 48;
const FOOTER_BAND = 50;
const CONTENT_TOP = A4_H - HEADER_BAND;
const TITLE_CAP = 80;
const BODY_CAP = 80_000;

type Block =
  | { kind: "h1" | "h2" | "p" | "bullet"; text: string }
  | { kind: "table"; rows: string[][] };

export async function pdfBytes(args: Record<string, unknown>): Promise<OfficeFile> {
  const report = parseReport(args);
  const title = clipTitle(
    report?.title || asString(args.title) || asString(args.name) || "Document",
  );
  const markdown = report
    ? reportToMarkdown(report)
    : clip(asString(args.body) || asString(args.content) || asString(args.text), BODY_CAP);
  const audience = clipTitle(
    report?.audience || asString(args.audience) || inferAudience(title, markdown),
  );
  const date = report?.date || asString(args.date) || todayUk();
  const blocks = parseBlocks(markdown, title);

  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("AllTheWay");
  doc.setCreator("AllTheWay");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([A4_W, A4_H]);
  let y = masthead(page, title, audience, date, bold, italic);

  for (const block of blocks) {
    if (block.kind === "table") {
      const needed = 28 + block.rows.length * 18;
      if (y < FOOTER_BAND + needed) {
        page = doc.addPage([A4_W, A4_H]);
        y = CONTENT_TOP - 8;
      }
      y = drawTable(page, block.rows, y, regular, bold);
      continue;
    }
    if (block.kind === "h1" || block.kind === "h2") {
      const lines = wrap(block.text, bold, 13, A4_W - MARGIN * 2);
      if (y < FOOTER_BAND + lines.length * 16 + 8) {
        page = doc.addPage([A4_W, A4_H]);
        y = CONTENT_TOP - 8;
      }
      y -= 16;
      y = drawLines(page, lines, y, bold, 13, NAVY, 16);
      continue;
    }
    const size = 11;
    const prefix = block.kind === "bullet" ? "•  " : "";
    const lines = wrap(prefix + block.text.replace(/\*\*/g, ""), regular, size, A4_W - MARGIN * 2 - (block.kind === "bullet" ? 8 : 0));
    if (y < FOOTER_BAND + lines.length * 14 + 8) {
      page = doc.addPage([A4_W, A4_H]);
      y = CONTENT_TOP - 8;
    }
    y = drawLines(page, lines, y, regular, size, INK, 14);
  }

  const pages = doc.getPages();
  const footer = audience ? `Prepared for ${audience}  ·  Confidential` : "Confidential";
  pages.forEach((p, i) => stampChrome(p, regular, bold, footer, i + 1, pages.length));

  return {
    title,
    mimeType: MIME_PDF,
    body: Buffer.from(await doc.save()),
    prompt: `PDF: ${title}`,
  };
}

function masthead(
  page: PDFPage,
  title: string,
  audience: string,
  date: string,
  bold: PDFFont,
  italic: PDFFont,
): number {
  let y = CONTENT_TOP - 12;
  const titleLines = wrap(title, bold, 20, A4_W - MARGIN * 2);
  y = drawLines(page, titleLines, y, bold, 20, NAVY, 24);
  y -= 6;
  const meta = [date, audience ? `For ${audience}` : "", "Confidential"].filter(Boolean).join("  ·  ");
  page.drawText(meta, { x: MARGIN, y, size: 10, font: italic, color: MUTED });
  y -= 10;
  page.drawRectangle({ x: MARGIN, y, width: A4_W - MARGIN * 2, height: 1.5, color: BLUE });
  return y - 18;
}

function stampChrome(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  footer: string,
  n: number,
  total: number,
): void {
  page.drawText("AllTheWay", { x: MARGIN, y: A4_H - 28, size: 9, font: bold, color: NAVY });
  page.drawText("BRIEFING", {
    x: A4_W - MARGIN - regular.widthOfTextAtSize("BRIEFING", 9),
    y: A4_H - 28,
    size: 9,
    font: regular,
    color: MUTED,
  });
  page.drawRectangle({
    x: MARGIN,
    y: A4_H - 36,
    width: A4_W - MARGIN * 2,
    height: 0.8,
    color: NAVY,
  });
  page.drawRectangle({
    x: MARGIN,
    y: 36,
    width: A4_W - MARGIN * 2,
    height: 0.6,
    color: RULE,
  });
  page.drawText(pdfSafe(footer), { x: MARGIN, y: 22, size: 8, font: regular, color: MUTED });
  const pages = `Page ${n} of ${total}`;
  page.drawText(pages, {
    x: A4_W - MARGIN - regular.widthOfTextAtSize(pages, 8),
    y: 22,
    size: 8,
    font: regular,
    color: MUTED,
  });
}

function drawLines(
  page: PDFPage,
  lines: string[],
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  leading: number,
): number {
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y, size, font, color });
    y -= leading;
  }
  return y - 4;
}

function drawTable(
  page: PDFPage,
  rows: string[][],
  y: number,
  regular: PDFFont,
  bold: PDFFont,
): number {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = A4_W - MARGIN * 2;
  const colW = width / cols;
  const rowH = 18;
  rows.forEach((row, r) => {
    const header = r === 0;
    page.drawRectangle({
      x: MARGIN,
      y: y - rowH + 4,
      width,
      height: rowH,
      color: header ? NAVY : r % 2 === 1 ? WASH : rgb(1, 1, 1),
    });
    for (let c = 0; c < cols; c++) {
      const text = pdfSafe((row[c] ?? "")).slice(0, 42);
      page.drawText(text, {
        x: MARGIN + 6 + c * colW,
        y: y - 8,
        size: 8,
        font: header ? bold : regular,
        color: header ? rgb(1, 1, 1) : INK,
      });
    }
    y -= rowH;
  });
  return y - 10;
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfSafe(text: string): string {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (ch) => {
    const map: Record<string, string> = {
      "£": "GBP",
      "€": "EUR",
      "–": "-",
      "—": "-",
      "’": "'",
      "‘": "'",
      "“": '"',
      "”": '"',
      "…": "...",
      "•": "-",
      "≤": "<=",
      "≥": ">=",
    };
    return map[ch] ?? " ";
  });
}

function parseBlocks(body: string, title: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  const titleNorm = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? "").trimEnd();
    i += 1;
    if (!line.trim()) continue;
    if (/^\|/.test(line) && line.includes("|")) {
      const rows: string[][] = [splitRow(line)];
      while (i < lines.length && /^\|/.test(lines[i] ?? "")) {
        const next = (lines[i] ?? "").trimEnd();
        i += 1;
        if (/^\|?\s*:?-{3,}/.test(next)) continue;
        rows.push(splitRow(next));
      }
      if (rows.length) out.push({ kind: "table", rows });
      continue;
    }
    if (line.startsWith("## ")) {
      out.push({ kind: "h2", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("# ")) {
      const text = line.slice(2).trim();
      const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (norm === titleNorm || norm.includes(titleNorm) || titleNorm.includes(norm)) continue;
      out.push({ kind: "h1", text });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      out.push({ kind: "bullet", text: line.replace(/^[-*]\s+/, "").trim() });
      continue;
    }
    out.push({ kind: "p", text: line.trim() });
  }
  return out.slice(0, 400);
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function inferAudience(title: string, body: string): string {
  const blob = `${title} ${body.slice(0, 400)}`.toLowerCase();
  if (/board/.test(blob)) return "the Board";
  if (/exec/.test(blob)) return "the executive team";
  return "";
}

function todayUk(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clip(value: string, cap: number): string {
  const trimmed = value.trim();
  return trimmed.length <= cap ? trimmed : trimmed.slice(0, cap);
}

function clipTitle(value: string): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (!one) return "Untitled";
  return one.length <= TITLE_CAP ? one : `${one.slice(0, TITLE_CAP - 1).trimEnd()}…`;
}
