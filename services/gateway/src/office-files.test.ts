import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";

import { buildOfficeFile } from "./office-files.js";
import { previewBytes } from "./office-preview.js";
import { MIME_SHEET, MIME_SLIDES, MIME_WORD } from "./office-mime.js";

function isZip(body: Buffer): boolean {
  return body.length > 4 && body[0] === 0x50 && body[1] === 0x4b;
}

test("a Word request becomes a real .docx", async () => {
  const file = await buildOfficeFile("create_document", {
    title: "Q4 launch brief",
    body: "# Goals\n- Finalise messaging\n- Ship the assets",
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  assert.equal(file.mimeType, MIME_WORD);
  assert.ok(isZip(file.body), "docx is a ZIP");
  const preview = await previewBytes(file.mimeType, file.body);
  assert.equal(preview.format, "word");
  assert.ok(preview.paragraphs?.some((p) => /Q4 launch brief|Goals|messaging/i.test(p)));
});

test("a Word document has a header, footer, and no duplicate title", async () => {
  const file = await buildOfficeFile("create_document", {
    title: "Q4 launch brief",
    kind: "briefing",
    audience: "the Board",
    body: "# Q4 Launch Briefing\n## Executive Summary\nOverview of the launch.\n\n## Goals\n- **Revenue:** Hit the Q4 ARR milestone.\n\n## Milestones\n| When | What |\n| --- | --- |\n| T-4 weeks | Feature freeze |\n| Launch day | General availability |\n",
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  const zip = await JSZip.loadAsync(file.body);
  assert.ok(zip.file("word/header1.xml"), "header part");
  assert.ok(zip.file("word/footer1.xml"), "footer part");
  const xml = await zip.file("word/document.xml")?.async("string");
  assert.ok(xml);
  assert.match(xml, /<w:tbl[\s>]/, "tables are real OOXML tables");
  const preview = await previewBytes(file.mimeType, file.body);
  const titleHits = (preview.paragraphs ?? []).filter((p) => /^Q4 launch brief$/i.test(p.trim()));
  assert.equal(titleHits.length, 1, "title appears once");
  assert.ok(preview.paragraphs?.some((p) => /Feature freeze/i.test(p)));
  assert.ok(preview.paragraphs?.some((p) => /Revenue/i.test(p)));
});

test("a spreadsheet request becomes a real .xlsx with headers and rows", async () => {
  const file = await buildOfficeFile("create_spreadsheet", {
    title: "Budget",
    headers: ["Item", "Cost"],
    rows: [
      ["Ads", "12000"],
      ["Print", "4000"],
    ],
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  assert.equal(file.mimeType, MIME_SHEET);
  assert.ok(isZip(file.body));
  const preview = await previewBytes(file.mimeType, file.body);
  assert.equal(preview.format, "sheet");
  const sheet = preview.sheets?.[0];
  assert.ok(sheet);
  assert.ok(sheet.rows.some((row) => row.includes("Ads")));
  assert.ok(sheet.rows.some((row) => row.includes("12000")));
  assert.ok(sheet.rows.some((row) => row.some((cell) => /total/i.test(cell))));
});

test("a PowerPoint request becomes a real .pptx with slides", async () => {
  const file = await buildOfficeFile("create_slides", {
    title: "Q4 review",
    audience: "the Board",
    slides: [
      { title: "Where we are", bullets: ["Pipeline is up", "Two deals slipped"] },
      { title: "Next", bullets: ["Close Acme", "Hire one AE"] },
    ],
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  assert.equal(file.mimeType, MIME_SLIDES);
  assert.ok(isZip(file.body));
  const preview = await previewBytes(file.mimeType, file.body);
  assert.equal(preview.format, "slides");
  assert.ok((preview.slides?.length ?? 0) >= 2);
  assert.ok(preview.slides?.some((s) => /Where we are/i.test(s.title) || s.bullets.some((b) => /Pipeline is up/i.test(b))));
});

test("a PDF request becomes a real PDF with a masthead", async () => {
  const file = await buildOfficeFile("create_pdf", {
    title: "Q4 launch brief",
    kind: "briefing",
    audience: "the Board",
    body: "## Executive Summary\nOverview of the launch.\n\n## Goals\n- **Revenue:** Hit the ARR milestone.\n",
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  assert.equal(file.mimeType, "application/pdf");
  assert.ok(file.body.subarray(0, 5).toString("utf8") === "%PDF-");
  const { PDFDocument } = await import("pdf-lib");
  const loaded = await PDFDocument.load(file.body);
  assert.equal(loaded.getTitle(), "Q4 launch brief");
  assert.ok(loaded.getPageCount() >= 1);
});

test("a markdown request becomes a utf-8 note with headings", async () => {
  const file = await buildOfficeFile("create_markdown", {
    title: "Q4 launch brief",
    body: "## Goals\n- Finalise messaging\n- Ship the assets",
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  assert.equal(file.mimeType, "text/markdown");
  const text = file.body.toString("utf8");
  assert.match(text, /Q4 launch brief/);
  assert.match(text, /Goals/);
  const preview = await previewBytes(file.mimeType, file.body);
  assert.equal(preview.format, "text");
  assert.match(preview.text ?? "", /Finalise messaging/);
});

test("an unknown file type is refused", async () => {
  const file = await buildOfficeFile("create_epub", { title: "Nope" });
  assert.ok("error" in file);
});

test("a deck.v1 two-card layout is shapes, not a bullet dump", async () => {
  const file = await buildOfficeFile("create_slides", {
    ir: "deck.v1",
    title: "Q4 launch",
    audience: "the Board",
    slides: [
      { layout: "title", kicker: "Board briefing", subtitle: "2 September 2026" },
      {
        layout: "two-card",
        title: "What ships",
        cards: [
          { title: "In", body: "Messaging freeze." },
          { title: "Waits", body: "Partner marketplace." },
        ],
      },
      {
        layout: "chart",
        title: "Budget",
        chart: {
          type: "bar",
          categories: ["Ads", "Events"],
          series: [{ name: "GBP", values: [120, 80] }],
        },
      },
    ],
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  assert.ok(isZip(file.body));
  const zip = await JSZip.loadAsync(file.body);
  const chartParts = Object.keys(zip.files).filter((name) => name.startsWith("ppt/charts/"));
  assert.ok(chartParts.length >= 1, "native Office chart part");
  const preview = await previewBytes(file.mimeType, file.body);
  assert.ok(preview.slides?.some((s) => /What ships|In|Waits/i.test(`${s.title} ${s.bullets.join(" ")}`)));
  const xml = await zip.file("ppt/slides/slide2.xml")?.async("string");
  assert.ok(xml);
  assert.match(xml, /<p:sp[\s>]/, "card layout uses shapes");
});

test("metric detail and card1 items survive into the file", async () => {
  const file = await buildOfficeFile("create_slides", {
    ir: "deck.v1",
    title: "Q4",
    slides: [
      { layout: "title", title: "Q4", subtitle: "Go-forward decisions" },
      {
        layout: "metric-row",
        title: "Impact",
        metrics: [{ label: "Net New ARR", value: "$1.45M", detail: "112% of Q4 Target" }],
      },
    ],
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  const zip = await JSZip.loadAsync(file.body);
  const xml = await zip.file("ppt/slides/slide2.xml")?.async("string");
  assert.ok(xml);
  assert.match(xml, /112% of Q4 Target/);
});

test("planner-shaped card1/card2 and root chart fields still compile", async () => {
  const file = await buildOfficeFile("create_slides", {
    ir: "deck.v1",
    title: "Q4 Product Launch Review",
    audience: "Executive Leadership",
    slides: [
      { layout: "title", title: "Q4 Product Launch Review", subtitle: "Go-forward" },
      {
        layout: "two-card",
        title: "What ships",
        card1: {
          title: "Shipping in Q4",
          items: ["Enterprise SSO (Owner: Sarah Chen)"],
        },
        card2: {
          title: "Deferred to Q1",
          items: ["Webhook Marketplace (Owner: Liam Patel)"],
        },
      },
      {
        layout: "chart",
        title: "Budget vs actuals",
        chart_type: "bar",
        categories: ["Product", "GTM"],
        series: [
          { name: "Budget", values: [350, 220] },
          { name: "Actual", values: [335, 240] },
        ],
      },
      {
        layout: "closing-ask",
        title: "Decision",
        decision: "Approve the 15 November rollout.",
        next_steps: ["Sign-off by Friday"],
      },
    ],
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  const zip = await JSZip.loadAsync(file.body);
  const chartParts = Object.keys(zip.files).filter((name) => name.startsWith("ppt/charts/") && name.endsWith(".xml"));
  assert.ok(chartParts.length >= 1, "native Office chart part from root-level fields");
  const cardXml = await zip.file("ppt/slides/slide2.xml")?.async("string");
  assert.ok(cardXml);
  assert.match(cardXml, /Enterprise SSO/);
  assert.match(cardXml, /Webhook Marketplace/);
  const askXml = await zip.file("ppt/slides/slide4.xml")?.async("string");
  assert.ok(askXml);
  assert.match(askXml, /Approve the 15 November rollout/);
});

test("leftCard and rightCard compile onto the two-card slide", async () => {
  const file = await buildOfficeFile("create_slides", {
    ir: "deck.v1",
    title: "Q4 held; GTM overspent",
    slides: [
      { layout: "title", title: "Q4 held; GTM overspent" },
      {
        layout: "two-card",
        title: "SSO ships; marketplace waits",
        leftCard: {
          status: "On Track",
          title: "SSO Delivery",
          body: "Target ship date: 15 November.",
        },
        rightCard: {
          status: "Waiting",
          title: "Marketplace",
          body: "Blocked pending ecosystem readiness.",
        },
      },
    ],
  });
  assert.ok(!("error" in file));
  if ("error" in file) return;
  const zip = await JSZip.loadAsync(file.body);
  const xml = await zip.file("ppt/slides/slide2.xml")?.async("string");
  assert.ok(xml);
  assert.match(xml, /SSO Delivery/);
  assert.match(xml, /Marketplace/);
  assert.doesNotMatch(xml, />One</);
  const preview = await previewBytes(file.mimeType, file.body);
  assert.equal(preview.format, "slides");
  assert.ok(preview.slides?.[0]?.title);
  assert.doesNotMatch(preview.slides?.[0]?.title ?? "", /alltheway/i);
  assert.match(preview.slides?.[0]?.title ?? "", /Q4 held/i);
});

test("report.v1 compiles to Word and PDF", async () => {
  const args = {
    ir: "report.v1",
    title: "Q4 launch",
    audience: "the Board",
    kind: "briefing",
    sections: [
      { heading: "Goals", bullets: ["**Revenue:** Hit the ARR milestone."] },
      {
        heading: "Milestones",
        table: [
          ["When", "What"],
          ["T-4 weeks", "Feature freeze"],
        ],
      },
    ],
  };
  const word = await buildOfficeFile("create_document", args);
  assert.ok(!("error" in word));
  if ("error" in word) return;
  const preview = await previewBytes(word.mimeType, word.body);
  assert.ok(preview.paragraphs?.some((p) => /Goals|Revenue|Feature freeze/i.test(p)));
  const pdf = await buildOfficeFile("create_pdf", args);
  assert.ok(!("error" in pdf));
  if ("error" in pdf) return;
  assert.equal(pdf.body.subarray(0, 5).toString("utf8"), "%PDF-");
});
