import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { ArtifactPreview } from "@alltheway/contracts";

import {
  MIME_SHEET,
  MIME_SLIDES,
  MIME_WORD,
  isOfficeMime,
  isTextEditableMime,
} from "./office-mime.js";

/**
 * A preview a person can read without installing Office.
 *
 * Word and PowerPoint are ZIP+XML; we lift visible text. Spreadsheets are
 * opened with the same library that wrote them so numbers stay numbers.
 */

const TEXT_CAP = 40_000;
const ROW_CAP = 80;
const COL_CAP = 16;
const SLIDE_CAP = 30;

export async function previewBytes(mimeType: string, body: Buffer): Promise<ArtifactPreview> {
  if (mimeType.startsWith("image/")) {
    return { mimeType, format: "image" };
  }
  if (mimeType.startsWith("video/")) {
    return { mimeType, format: "video" };
  }
  if (mimeType === MIME_WORD) {
    return { mimeType, format: "word", paragraphs: await wordParagraphs(body) };
  }
  if (mimeType === MIME_SHEET) {
    return { mimeType, format: "sheet", sheets: await sheetRows(body) };
  }
  if (mimeType === MIME_SLIDES) {
    return { mimeType, format: "slides", slides: await slideText(body) };
  }
  if (mimeType === "application/pdf") {
    return { mimeType, format: "binary" };
  }
  if (isTextEditableMime(mimeType) && !isOfficeMime(mimeType)) {
    const text = body.toString("utf8");
    return {
      mimeType,
      format: "text",
      text: text.length <= TEXT_CAP ? text : `${text.slice(0, TEXT_CAP)}\n…`,
    };
  }
  return { mimeType, format: "binary" };
}

async function wordParagraphs(body: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(body);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return [];
  return xmlTexts(xml, "w:t").slice(0, 400);
}

async function sheetRows(body: Buffer): Promise<Array<{ name: string; rows: string[][] }>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as never);
  const sheets: Array<{ name: string; rows: string[][] }> = [];
  workbook.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, index) => {
      if (index > ROW_CAP) return;
      const cells = (row.values as unknown[])
        .slice(1, COL_CAP + 1)
        .map((cell) => cellText(cell));
      rows.push(cells);
    });
    sheets.push({ name: ws.name || "Sheet", rows });
  });
  return sheets.slice(0, 12);
}

async function slideText(
  body: Buffer,
): Promise<Array<{ title: string; bullets: string[]; image?: string }>> {
  const zip = await JSZip.loadAsync(body);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideIndex(a) - slideIndex(b))
    .slice(0, SLIDE_CAP);

  const slides: Array<{ title: string; bullets: string[]; image?: string }> = [];
  for (const name of names) {
    const n = slideIndex(name);
    const xml = await zip.file(name)?.async("string");
    const texts = (xml ? xmlTexts(xml, "a:t") : []).filter((t) => !isSlideChrome(t));
    const image = await stillDataUri(zip, n);
    slides.push({
      title: texts[0] || `Slide ${slides.length + 1}`,
      bullets: texts.slice(1, 12),
      ...(image ? { image } : {}),
    });
  }
  return slides;
}

function isSlideChrome(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^alltheway\b/i.test(t) && t.length < 48) return true;
  if (/^confidential$/i.test(t)) return true;
  if (/^briefing$/i.test(t)) return true;
  if (/^prepared for\b/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(t)) return true;
  if (/^\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(t)) {
    return true;
  }
  if (/\bconfidential$/i.test(t) && t.length < 56) return true;
  return false;
}

async function stillDataUri(zip: JSZip, slideNumber: number): Promise<string | undefined> {
  const name = Object.keys(zip.files).find((file) =>
    new RegExp(`^ppt/media/image-${slideNumber}-`, "i").test(file),
  );
  if (!name) return undefined;
  const bytes = await zip.file(name)?.async("nodebuffer");
  if (!bytes?.length) return undefined;
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function slideIndex(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

function xmlTexts(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  for (const match of xml.matchAll(re)) {
    const text = decodeXml(match[1] ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cellText(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
    return String(cell);
  }
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object" && "text" in (cell as object)) {
    return String((cell as { text: unknown }).text ?? "");
  }
  if (typeof cell === "object" && "result" in (cell as object)) {
    return String((cell as { result: unknown }).result ?? "");
  }
  return "";
}
