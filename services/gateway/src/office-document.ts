import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  PageNumber,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

import { parseReport, reportToMarkdown } from "./office-ir.js";
import { MIME_WORD } from "./office-mime.js";

/**
 * Designed Word generation — the renderer half of the document skill.
 *
 * Anthropic's docx skill is explicit: a file that looks authored uses named
 * styles, A4/Letter set in DXA, dual-width tables, LevelFormat bullets, and
 * paragraph borders for rules. This is that skill, after Yes. It is not a
 * markdown dump with Heading 1 on the title.
 *
 * UK-first product: A4, Arial (universally present in Word).
 */

export type OfficeDocument = {
  title: string;
  mimeType: string;
  body: Buffer;
  prompt: string;
};

const NAVY = "022478";
const BLUE = "0269E6";
const INK = "0B1533";
const MUTED = "5A6785";
const RULE = "DCE3F2";
const WASH = "F3F6FD";
const WHITE = "FFFFFF";
const FONT = "Arial";

const A4_W = 11906;
const A4_H = 16838;
const MARGIN = 1440;
const CONTENT_W = A4_W - MARGIN * 2;
const TITLE_CAP = 80;
const BODY_CAP = 80_000;

type Borders = {
  top: { style: typeof BorderStyle.SINGLE; size: number; color: string };
  bottom: { style: typeof BorderStyle.SINGLE; size: number; color: string };
  left: { style: typeof BorderStyle.SINGLE; size: number; color: string };
  right: { style: typeof BorderStyle.SINGLE; size: number; color: string };
};

type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "bullet" | "number"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; rows: string[][] };

export async function documentBytes(args: Record<string, unknown>): Promise<OfficeDocument> {
  const report = parseReport(args);
  const title = clipTitle(
    report?.title || asString(args.title) || asString(args.name) || "Document",
  );
  const body = report ? reportToMarkdown(report) : assembleBody(args);
  const audience = clipTitle(
    report?.audience || asString(args.audience) || asString(args.for) || inferAudience(title, body),
  );
  const kind = inferKind(report?.kind || asString(args.kind) || asString(args.type), title, body, audience);
  const date = report?.date || asString(args.date) || todayUk();
  const blocks = designBlocks(parseBlocks(body, title), title);

  const children = [...masthead(title, kind, audience, date), ...renderBlocks(blocks)];

  const doc = new Document({
    creator: "AllTheWay",
    title,
    description: `${kindLabel(kind)} prepared ${date}`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, color: INK },
          paragraph: { spacing: { after: 160, line: 276 } },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 44, bold: true, color: NAVY },
          paragraph: { spacing: { before: 40, after: 80 }, outlineLevel: 0 },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 26, bold: true, color: NAVY },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 22, bold: true, color: NAVY },
          paragraph: { spacing: { before: 280, after: 80 }, outlineLevel: 1 },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 20, bold: true, color: INK },
          paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "atw-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 240 } } },
            },
          ],
        },
        {
          reference: "atw-numbers",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_W, height: A4_H },
            margin: {
              top: 1134,
              right: MARGIN,
              bottom: 1134,
              left: MARGIN,
              header: 568,
              footer: 568,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
                border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 4 } },
                spacing: { after: 80 },
                children: [
                  new TextRun({ text: "AllTheWay", bold: true, color: NAVY, size: 18, font: FONT }),
                  new TextRun({ text: "\t", font: FONT }),
                  new TextRun({
                    text: kindLabel(kind).toUpperCase(),
                    color: MUTED,
                    size: 16,
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
                border: { top: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } },
                spacing: { before: 80 },
                children: [
                  new TextRun({
                    text: audience ? `Prepared for ${audience}  ·  Confidential` : "Confidential",
                    color: MUTED,
                    size: 16,
                    font: FONT,
                  }),
                  new TextRun({ text: "\t", font: FONT }),
                  new TextRun({ text: "Page ", color: MUTED, size: 16, font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16, font: FONT }),
                  new TextRun({ text: " of ", color: MUTED, size: 16, font: FONT }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    color: MUTED,
                    size: 16,
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        children: children.length ? children : [new Paragraph({ text: title })],
      },
    ],
  });

  const packed = await Packer.toBuffer(doc);
  return {
    title,
    mimeType: MIME_WORD,
    body: Buffer.from(packed),
    prompt: `Word document: ${title}`,
  };
}

function assembleBody(args: Record<string, unknown>): string {
  const parts = [clip(asString(args.body) || asString(args.content) || asString(args.text), BODY_CAP)];
  const sections = Array.isArray(args.sections) ? args.sections : [];
  for (const raw of sections) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const heading = asString(rec.heading || rec.title || rec.name);
    const text = asString(rec.body || rec.text);
    const bullets = Array.isArray(rec.bullets) ? rec.bullets : [];
    const lines: string[] = [];
    if (heading) lines.push(`## ${heading}`);
    if (text) lines.push(text);
    for (const bullet of bullets) {
      const line = asString(bullet);
      if (line) lines.push(`- ${line}`);
    }
    if (lines.length) parts.push(lines.join("\n"));
  }
  return parts.filter(Boolean).join("\n\n");
}

function masthead(title: string, kind: string, audience: string, date: string): Paragraph[] {
  const meta = [date, audience ? `For ${audience}` : "", "Confidential"].filter(Boolean).join("  ·  ");
  return [
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: kindLabel(kind).toUpperCase(),
          bold: true,
          color: BLUE,
          size: 18,
          font: FONT,
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, font: FONT })],
    }),
    new Paragraph({
      spacing: { before: 40, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: BLUE, space: 1 } },
      children: [new TextRun({ text: meta, color: MUTED, size: 18, italics: true, font: FONT })],
    }),
  ];
}

function designBlocks(blocks: Block[], title: string): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "p" && sameTitle(block.text, title)) continue;
    if (block.kind === "h1" && sameTitle(block.text, title)) continue;
    out.push(block);
  }
  const hasExec = out.some((b) => isHeading(b) && /executive summary/i.test(b.text));
  if (!hasExec) {
    const first = out.findIndex((b) => b.kind === "p");
    if (first === 0) {
      const text = (out[0] as { text: string }).text;
      out.splice(0, 1, { kind: "h1", text: "Executive Summary" }, { kind: "p", text });
    }
  }
  return out;
}

function renderBlocks(blocks: Block[]): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.kind === "table") {
      out.push(styledTable(block.rows));
      continue;
    }
    if (block.kind === "rule") {
      out.push(horizontalRule());
      continue;
    }
    if (isHeading(block) && /executive summary/i.test(block.text)) {
      const paras: string[] = [];
      while (i + 1 < blocks.length && blocks[i + 1]?.kind === "p") {
        i += 1;
        paras.push((blocks[i] as { text: string }).text);
      }
      out.push(heading(block.text, HeadingLevel.HEADING_1));
      out.push(callout(paras.join(" ") || "—"));
      continue;
    }
    if (block.kind === "h1") out.push(heading(block.text, HeadingLevel.HEADING_1));
    else if (block.kind === "h2") out.push(heading(block.text, HeadingLevel.HEADING_2));
    else if (block.kind === "h3") out.push(heading(block.text, HeadingLevel.HEADING_3));
    else if (block.kind === "quote") out.push(callout(block.text));
    else if (block.kind === "bullet") {
      out.push(
        new Paragraph({
          numbering: { reference: "atw-bullets", level: 0 },
          spacing: { after: 80 },
          children: styledRuns(block.text),
        }),
      );
    } else if (block.kind === "number") {
      out.push(
        new Paragraph({
          numbering: { reference: "atw-numbers", level: 0 },
          spacing: { after: 80 },
          children: styledRuns(block.text),
        }),
      );
    } else {
      out.push(new Paragraph({ spacing: { after: 160 }, children: styledRuns(block.text) }));
    }
  }
  return out;
}

function isHeading(block: Block): block is { kind: "h1" | "h2" | "h3"; text: string } {
  return block.kind === "h1" || block.kind === "h2" || block.kind === "h3";
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text, font: FONT })],
  });
}

function horizontalRule(): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 1 } },
    children: [new TextRun({ text: " ", font: FONT, size: 4 })],
  });
}

function callout(text: string): Table {
  const hair = { style: BorderStyle.SINGLE, size: 4, color: RULE } as const;
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { fill: WASH, type: ShadingType.CLEAR },
            margins: { top: 140, bottom: 140, left: 180, right: 180 },
            borders: {
              top: hair,
              bottom: hair,
              left: { style: BorderStyle.SINGLE, size: 24, color: BLUE },
              right: hair,
            },
            children: [new Paragraph({ children: styledRuns(text) })],
          }),
        ],
      }),
    ],
  });
}

function styledTable(rows: string[][]): Table {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const colW = Math.floor(CONTENT_W / cols);
  const widths = Array.from({ length: cols }, () => colW);
  widths[widths.length - 1] = CONTENT_W - colW * (cols - 1);
  const hair = { style: BorderStyle.SINGLE, size: 4, color: RULE } as const;
  const borders: Borders = { top: hair, bottom: hair, left: hair, right: hair };

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((row, r) => {
      const header = r === 0;
      return new TableRow({
        tableHeader: header,
        children: widths.map((w, c) =>
          cell(w, row[c] ?? "", {
            fill: header ? NAVY : r % 2 === 1 ? WASH : WHITE,
            color: header ? WHITE : INK,
            bold: header,
            borders,
          }),
        ),
      });
    }),
  });
}

function cell(
  width: number,
  text: string,
  opts: { fill: string; color?: string; bold?: boolean; borders: Borders },
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: opts.fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    borders: opts.borders,
    children: [
      new Paragraph({
        children: styledRuns(text, { color: opts.color, bold: opts.bold }),
      }),
    ],
  });
}

function styledRuns(text: string, force?: { color?: string; bold?: boolean }): TextRun[] {
  const color = force?.color ?? INK;
  const runs: TextRun[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      runs.push(run(text.slice(last, match.index), { color, bold: force?.bold }));
    }
    if (match[1] != null) runs.push(run(match[1], { color, bold: true }));
    else runs.push(run(match[2] ?? "", { color, italics: true, bold: force?.bold }));
    last = match.index + match[0].length;
  }
  const rest = text.slice(last);
  if (rest || runs.length === 0) runs.push(run(rest || text, { color, bold: force?.bold }));
  return runs;
}

function run(
  text: string,
  opts: { color: string; bold?: boolean; italics?: boolean },
): TextRun {
  return new TextRun({
    text,
    font: FONT,
    size: 22,
    color: opts.color,
    bold: opts.bold,
    italics: opts.italics,
  });
}

function parseBlocks(body: string, title: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? "").trimEnd();
    i += 1;
    if (!line.trim()) continue;

    if (/^---+$/.test(line.trim())) {
      out.push({ kind: "rule" });
      continue;
    }

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

    if (line.startsWith("> ")) {
      out.push({ kind: "quote", text: line.replace(/^>\s+/, "") });
      continue;
    }
    if (line.startsWith("### ")) {
      out.push({ kind: "h3", text: line.slice(4).trim() });
      continue;
    }
    if (line.startsWith("## ")) {
      out.push({ kind: "h2", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("# ")) {
      const text = line.slice(2).trim();
      if (sameTitle(text, title)) continue;
      out.push({ kind: "h1", text });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      out.push({ kind: "number", text: line.replace(/^\d+[.)]\s+/, "").trim() });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      out.push({ kind: "bullet", text: line.replace(/^[-*]\s+/, "").trim() });
      continue;
    }
    const labelled = line.trim().match(/^([A-Z][\w /&'-]{1,40}):\s+(.+)$/);
    if (labelled && !line.trim().startsWith("**")) {
      out.push({ kind: "bullet", text: `**${labelled[1]}:** ${labelled[2]}` });
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

function inferKind(explicit: string, title: string, body: string, audience: string): string {
  if (explicit) return explicit.toLowerCase();
  const blob = `${title} ${audience} ${body.slice(0, 400)}`.toLowerCase();
  if (/memo/.test(blob)) return "memo";
  if (/proposal/.test(blob)) return "proposal";
  if (/contract|agreement/.test(blob)) return "contract";
  if (/report/.test(blob)) return "report";
  if (/board|brief|exec/.test(blob)) return "briefing";
  return "briefing";
}

function inferAudience(title: string, body: string): string {
  const blob = `${title} ${body.slice(0, 400)}`.toLowerCase();
  if (/board/.test(blob)) return "the Board";
  if (/exec/.test(blob)) return "the executive team";
  return "";
}

function kindLabel(kind: string): string {
  if (kind === "memo") return "Memo";
  if (kind === "proposal") return "Proposal";
  if (kind === "contract") return "Contract";
  if (kind === "report") return "Report";
  return "Briefing";
}

function todayUk(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function sameTitle(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size) >= 0.7;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
