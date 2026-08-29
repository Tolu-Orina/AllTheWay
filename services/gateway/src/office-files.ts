import ExcelJS from "exceljs";

import { documentBytes } from "./office-document.js";
import { pdfBytes } from "./office-pdf.js";
import { slidesBytes } from "./office-slides.js";
import { MIME_SHEET, type WorkFilesTool } from "./office-mime.js";

/**
 * First-party Word / Excel / PowerPoint generation.
 *
 * Word, slides, and PDF are designed in their own modules. Spreadsheets are
 * built here with a navy header, freeze, and SUM totals. Not a Microsoft
 * 365 connector and does not need OAuth.
 *
 * In-browser WYSIWYG editing of those bytes is a different product
 * (OnlyOffice, Collabora). We generate, preview, and download.
 */

export type OfficeFile = {
  title: string;
  mimeType: string;
  body: Buffer;
  prompt: string;
};

export type OfficeBuild = OfficeFile | { error: string };

const TITLE_CAP = 80;
const BODY_CAP = 80_000;
const MAX_SHEETS = 12;
const MAX_ROWS = 200;
const MAX_COLS = 26;

export function officePrompt(tool: WorkFilesTool, title: string): string {
  if (tool === "create_document") return `Word document: ${title}`;
  if (tool === "create_spreadsheet") return `Spreadsheet: ${title}`;
  if (tool === "create_markdown") return `Markdown: ${title}`;
  if (tool === "create_pdf") return `PDF: ${title}`;
  return `PowerPoint: ${title}`;
}

export async function buildOfficeFile(
  tool: string,
  args: Record<string, unknown>,
): Promise<OfficeBuild> {
  try {
    if (tool === "create_document") return await documentBytes(args);
    if (tool === "create_spreadsheet") return await spreadsheetBytes(args);
    if (tool === "create_slides") return await slidesBytes(args);
    if (tool === "create_pdf") return await pdfBytes(args);
    if (tool === "create_markdown") return markdownBytes(args);
    return { error: "That file type is not something this can make." };
  } catch (err) {
    console.warn(`[office] ${tool} failed: ${(err as Error).message}`);
    return { error: "That file could not be built. Nothing was saved." };
  }
}

function markdownBytes(args: Record<string, unknown>): OfficeFile {
  const title = clipTitle(asString(args.title) || asString(args.name) || "Note");
  const body = clip(asString(args.body) || asString(args.content) || asString(args.text), BODY_CAP);
  const markdown = body.includes(title) ? body : `# ${title}\n\n${body}`.trim();
  return {
    title,
    mimeType: "text/markdown",
    body: Buffer.from(markdown || `# ${title}\n`, "utf8"),
    prompt: officePrompt("create_markdown", title),
  };
}

async function spreadsheetBytes(args: Record<string, unknown>): Promise<OfficeFile> {
  const title = clipTitle(asString(args.title) || asString(args.name) || "Spreadsheet");
  const sheets = parseSheets(args);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AllTheWay";
  workbook.title = title;

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31) || "Sheet");
    const rows = sheet.rows.map((row) => row.map(cellValue));
    for (const row of rows) ws.addRow(row);

    const colCount = Math.max(1, ...rows.map((row) => row.length));
    const moneyCols = new Set<number>();
    const header = rows[0] ?? [];
    for (let c = 0; c < colCount; c++) {
      if (isMoneyHeader(String(header[c] ?? ""))) moneyCols.add(c);
    }

    ws.columns.forEach((col, i) => {
      const longest = Math.max(10, ...rows.map((row) => String(row[i] ?? "").length));
      col.width = Math.min(42, longest + 3);
      if (moneyCols.has(i)) col.numFmt = "#,##0";
    });
    if (rows.length > 0) {
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 11 };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF022478" } };
      headerRow.height = 22;
      headerRow.alignment = { vertical: "middle" };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
    const hair = { style: "thin" as const, color: { argb: "FFDCE3F2" } };
    for (let r = 1; r <= rows.length; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.border = { top: hair, bottom: hair, left: hair, right: hair };
        cell.font = { ...(cell.font ?? {}), name: "Arial", size: 11 };
        if (r > 1 && r % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FD" } };
        }
      }
    }
    writeTotalRow(ws, rows, moneyCols, colCount);
  }

  const packed = await workbook.xlsx.writeBuffer();
  return {
    title,
    mimeType: MIME_SHEET,
    body: Buffer.from(packed),
    prompt: officePrompt("create_spreadsheet", title),
  };
}

function cellValue(cell: string): string | number {
  const trimmed = cell.trim();
  if (!trimmed) return "";
  const compact = trimmed.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(compact)) {
    const n = Number(compact);
    if (Number.isFinite(n)) return n;
  }
  return cell;
}

function isMoneyHeader(header: string): boolean {
  return /amount|cost|budget|price|total|spend|revenue|£|\$/i.test(header);
}

function writeTotalRow(
  ws: ExcelJS.Worksheet,
  rows: Array<Array<string | number>>,
  moneyCols: Set<number>,
  colCount: number,
): void {
  if (rows.length < 3) return;
  const last = rows[rows.length - 1] ?? [];
  const hasTotal = /total/i.test(String(last[0] ?? ""));
  const dataEnd = hasTotal ? rows.length - 1 : rows.length;
  if (dataEnd < 2) return;

  const numericCols = new Set<number>(moneyCols);
  for (let c = 1; c < colCount; c++) {
    const values = rows.slice(1, dataEnd).map((row) => row[c]);
    if (values.some((v) => typeof v === "number")) numericCols.add(c);
  }
  if (numericCols.size === 0) return;

  const totalIndex = hasTotal ? rows.length : rows.length + 1;
  const totalRow = ws.getRow(totalIndex);
  totalRow.getCell(1).value = hasTotal ? last[0] : "Total";
  for (const c of numericCols) {
    const letter = ws.getColumn(c + 1).letter;
    totalRow.getCell(c + 1).value = { formula: `SUM(${letter}2:${letter}${dataEnd})` };
  }
  totalRow.font = { bold: true, name: "Arial", size: 11 };
}

type SheetSpec = { name: string; rows: string[][] };

function parseSheets(args: Record<string, unknown>): SheetSpec[] {
  const named = asArray(args.sheets);
  if (named.length) {
    return named.slice(0, MAX_SHEETS).map((item, i) => sheetFromUnknown(item, `Sheet ${i + 1}`));
  }

  const csv = asString(args.csv) || asString(args.body) || asString(args.content);
  const headers = asStringList(args.headers);
  const rows = parseRows(args.rows);
  if (csv && !headers.length && !rows.length) {
    return [{ name: "Sheet1", rows: csvToRows(csv) }];
  }

  const table: string[][] = [];
  if (headers.length) table.push(headers.slice(0, MAX_COLS));
  for (const row of rows) table.push(row.slice(0, MAX_COLS));
  if (table.length === 0) table.push([clipTitle(asString(args.title) || "Sheet")]);
  return [{ name: "Sheet1", rows: table.slice(0, MAX_ROWS) }];
}

function sheetFromUnknown(item: unknown, fallback: string): SheetSpec {
  if (typeof item === "string") {
    return { name: fallback, rows: csvToRows(item) };
  }
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>;
    const name = clipTitle(asString(rec.name) || asString(rec.title) || fallback);
    const headers = asStringList(rec.headers);
    const rows = parseRows(rec.rows);
    const csv = asString(rec.csv);
    if (csv && !headers.length && !rows.length) {
      return { name, rows: csvToRows(csv) };
    }
    const table: string[][] = [];
    if (headers.length) table.push(headers.slice(0, MAX_COLS));
    for (const row of rows) table.push(row.slice(0, MAX_COLS));
    return { name, rows: table.slice(0, MAX_ROWS) };
  }
  return { name: fallback, rows: [[fallback]] };
}

function parseRows(value: unknown): string[][] {
  const list = asArray(value);
  return list.slice(0, MAX_ROWS).map((row) => {
    if (Array.isArray(row)) return row.map((cell) => String(cell ?? "")).slice(0, MAX_COLS);
    if (typeof row === "string") return row.split(",").map((c) => c.trim()).slice(0, MAX_COLS);
    return [String(row ?? "")];
  });
}

function csvToRows(csv: string): string[][] {
  return clip(csv, BODY_CAP)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, MAX_ROWS)
    .map((line) => line.split(",").map((c) => c.trim()).slice(0, MAX_COLS));
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* not JSON */
      }
    }
  }
  return [];
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? ""));
      } catch {
        /* not JSON */
      }
    }
    return trimmed.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).filter((s) => s.length > 0);
  return [];
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
