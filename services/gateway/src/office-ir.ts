/**
 * Layout IR for decks and reports.
 *
 * After Yes the document-cell planner owns layout, background, and x/y.
 * The worker paints that plan literally. The product orchestrator still
 * emits a story brief — legacy layout names still parse.
 */

export const DECK_IR = "deck.v1";
export const REPORT_IR = "report.v1";
export const MAX_SLIDES = 20;
export const MAX_CRITIQUE_ROUNDS = 3;
export const MAX_IMAGES = 8;
export const MAX_SUPPORTS = 4;
export const CONTENT_PASS_BAND = 4;
export const DESIGN_PASS_BAND = 4;
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

export const OFFICE_LAYOUTS = [
  "title-slide",
  "section-header",
  "title-and-body",
  "title-and-two-columns",
  "title-only",
  "one-column-text",
  "main-point",
  "section-title-and-description",
  "caption",
  "big-number",
  "blank",
] as const;

export type SlideLayout = (typeof OFFICE_LAYOUTS)[number];

export type Box = { x: number; y: number; w: number; h: number };

export type TextRole = "title" | "subtitle" | "body" | "caption" | "kicker" | "number";

export type TextBox = Box & {
  id?: string;
  role: TextRole;
  text: string;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
};

export type Picture = Box & {
  id: string;
  prompt: string;
  role: "background" | "picture";
};

export type ShapeMark = Box & {
  kind: "rect" | "ellipse" | "line";
  fill?: string;
  color?: string;
};

export type Background = {
  fill?: string;
  image?: { id: string; prompt: string };
};

export type ImageSlot = {
  kind: "generate" | "none";
  prompt?: string;
};

export type ChartSpec = {
  type: "bar" | "line" | "pie";
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export type SlideIr = {
  layout: SlideLayout;
  title?: string;
  kicker?: string;
  subtitle?: string;
  bullets?: string[];
  cards?: Array<{ title: string; body: string }>;
  metrics?: Array<{ label: string; value: string; owner?: string; detail?: string }>;
  asks?: string[];
  quote?: string;
  image?: ImageSlot;
  chart?: ChartSpec;
  background?: Background;
  boxes: TextBox[];
  shapes?: ShapeMark[];
  pictures?: Picture[];
};

export type DeckIr = {
  ir: typeof DECK_IR;
  title: string;
  audience?: string;
  date?: string;
  background?: Background;
  slides: SlideIr[];
};

export type ReportSection = {
  heading: string;
  body?: string;
  bullets?: string[];
  table?: string[][];
};

export type ReportIr = {
  ir: typeof REPORT_IR;
  title: string;
  audience?: string;
  kind?: string;
  date?: string;
  sections: ReportSection[];
};

export type LayoutIr = DeckIr | ReportIr;

const TITLE_CAP = 110;

const LEGACY_LAYOUT: Record<string, SlideLayout> = {
  title: "title-slide",
  "two-card": "title-and-two-columns",
  "metric-row": "big-number",
  "split-visual": "section-title-and-description",
  "photo-story": "section-header",
  chart: "title-and-body",
  "closing-ask": "title-and-body",
  quote: "main-point",
  agenda: "title-and-body",
  bullets: "title-and-body",
};

export function isDeckIr(value: unknown): value is DeckIr {
  return Boolean(value && typeof value === "object" && (value as DeckIr).ir === DECK_IR);
}

export function isReportIr(value: unknown): value is ReportIr {
  return Boolean(value && typeof value === "object" && (value as ReportIr).ir === REPORT_IR);
}

export function parseDeck(args: Record<string, unknown>): DeckIr {
  if (isDeckIr(args) || isDeckIr(args.deck)) {
    return validateDeck((args.ir === DECK_IR ? args : args.deck) as DeckIr);
  }
  const listed = asArray(args.slides);
  if (listed.some((item) => item && typeof item === "object" && "layout" in (item as object))) {
    return validateDeck({
      ir: DECK_IR,
      title: clipTitle(asString(args.title) || "Presentation"),
      audience: asString(args.audience) || undefined,
      date: asString(args.date) || undefined,
      background: backgroundFromUnknown(args.background),
      slides: listed.map(slideFromUnknown),
    });
  }
  return validateDeck(legacyDeck(args));
}

export function parseReport(args: Record<string, unknown>): ReportIr | null {
  if (isReportIr(args) || isReportIr(args.report)) {
    return validateReport((args.ir === REPORT_IR ? args : args.report) as ReportIr);
  }
  const sections = asArray(args.sections);
  if (sections.length && sections.every((s) => s && typeof s === "object")) {
    return validateReport({
      ir: REPORT_IR,
      title: clipTitle(asString(args.title) || "Document"),
      audience: asString(args.audience) || undefined,
      kind: asString(args.kind) || undefined,
      date: asString(args.date) || undefined,
      sections: sections.map(sectionFromUnknown),
    });
  }
  return null;
}

export function reportToMarkdown(report: ReportIr): string {
  const parts: string[] = [];
  for (const section of report.sections) {
    parts.push(`## ${section.heading}`);
    if (section.body) parts.push(section.body);
    for (const bullet of section.bullets ?? []) parts.push(`- ${bullet}`);
    if (section.table?.length) {
      const rows = section.table;
      const cols = Math.max(1, ...rows.map((r) => r.length));
      const header = rows[0] ?? Array.from({ length: cols }, () => "");
      parts.push(`| ${header.join(" | ")} |`);
      parts.push(`| ${header.map(() => "---").join(" | ")} |`);
      for (const row of rows.slice(1)) {
        const cells = Array.from({ length: cols }, (_, i) => row[i] ?? "");
        parts.push(`| ${cells.join(" | ")} |`);
      }
    }
  }
  return parts.join("\n\n");
}

export type NamedImage = { id: string; prompt: string };

export function imageSlots(deck: DeckIr): NamedImage[] {
  const seen = new Map<string, string>();
  const add = (id: string, prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || seen.has(id)) return;
    seen.set(id, trimmed);
  };
  if (deck.background?.image?.prompt) {
    add(deck.background.image.id || "deck-bg", deck.background.image.prompt);
  }
  deck.slides.forEach((slide, index) => {
    if (slide.background?.image?.prompt) {
      add(slide.background.image.id || `s${index}-bg`, slide.background.image.prompt);
    }
    if ((slide.pictures ?? []).length) {
      for (const picture of slide.pictures ?? []) {
        if (picture.prompt?.trim()) add(picture.id || `s${index}-${picture.role}`, picture.prompt);
      }
    } else if (slide.image?.kind === "generate" && slide.image.prompt?.trim()) {
      add(`s${index}-image`, slide.image.prompt.trim());
    }
  });
  return [...seen.entries()].map(([id, prompt]) => ({ id, prompt })).slice(0, MAX_IMAGES);
}

export function applyDeckPatch(deck: DeckIr, patch: unknown): DeckIr {
  if (!patch || typeof patch !== "object") return deck;
  const rec = patch as Record<string, unknown>;
  const next: DeckIr = {
    ...deck,
    title: asString(rec.title) || deck.title,
    audience: asString(rec.audience) || deck.audience,
    date: asString(rec.date) || deck.date,
    background: backgroundFromUnknown(rec.background) ?? deck.background,
    slides: deck.slides.map((slide) => ({ ...slide })),
  };
  const slides = asArray(rec.slides);
  if (slides.length >= deck.slides.length) {
    next.slides = slides.map(slideFromUnknown);
  } else if (slides.length) {
    const copy = deck.slides.map((slide) => ({ ...slide }));
    slides.forEach((raw, i) => {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const idxRaw = Number(item.index);
      const idx = Number.isInteger(idxRaw) ? idxRaw : i;
      if (idx < 0 || idx >= copy.length) return;
      copy[idx] = slideFromUnknown({ ...copy[idx], ...item });
    });
    next.slides = copy;
  }
  return validateDeck(next);
}

export type DeckEdit = {
  op: "replace_text" | "resize_box" | "swap_picture" | "drop_box";
  slideIndex: number;
  elementId: string;
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  prompt?: string;
};

export function applyDeckEdits(deck: DeckIr, edits: unknown): DeckIr {
  if (!Array.isArray(edits) || !edits.length) return deck;
  const slides = deck.slides.map((slide) => ({
    ...slide,
    boxes: slide.boxes.map((box) => ({ ...box })),
    pictures: slide.pictures?.map((picture) => ({ ...picture })),
    shapes: slide.shapes?.map((shape) => ({ ...shape })),
    chart: slide.chart ? { ...slide.chart } : undefined,
  }));
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const op = asString(rec.op);
    const slideIndex = Number(rec.slideIndex ?? rec.index);
    const elementId = asString(rec.elementId);
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slides.length || !elementId) {
      continue;
    }
    const slide = slides[slideIndex]!;
    if (op === "replace_text") {
      const box = findBox(slide, elementId);
      const text = asString(rec.text);
      if (box && text) box.text = text;
    } else if (op === "resize_box") {
      const box = findBox(slide, elementId) ?? (slide.pictures ?? []).find((p) => p.id === elementId);
      if (box) {
        if (rec.x !== undefined) box.x = asNum(rec.x);
        if (rec.y !== undefined) box.y = asNum(rec.y);
        if (rec.w !== undefined) box.w = asNum(rec.w);
        if (rec.h !== undefined) box.h = asNum(rec.h);
      }
    } else if (op === "swap_picture") {
      const picture = (slide.pictures ?? []).find((p) => p.id === elementId);
      const prompt = asString(rec.prompt);
      if (picture && prompt) picture.prompt = prompt;
    } else if (op === "drop_box") {
      slide.boxes = slide.boxes.filter((box, i) => boxId(box, slideIndex, i) !== elementId);
      if (slide.pictures) slide.pictures = slide.pictures.filter((p) => p.id !== elementId);
    }
  }
  return validateDeck({ ...deck, slides });
}

function findBox(slide: SlideIr, elementId: string): TextBox | undefined {
  return slide.boxes.find((box, i) => boxId(box, 0, i) === elementId || box.id === elementId);
}

function boxId(box: TextBox, slideIndex: number, i: number): string {
  return box.id || `s${slideIndex}-${box.role}-${i}`;
}

export function structuralIssues(deck: DeckIr): string[] {
  const issues: string[] = [];
  if (deck.slides.length === 0) issues.push("deck has no slides");
  for (const [i, slide] of deck.slides.entries()) {
    const n = i + 1;
    if ((slide.title ?? "").length > TITLE_CAP) issues.push(`slide ${n}: title too long`);
    if ((slide.bullets ?? []).length > MAX_SUPPORTS) issues.push(`slide ${n}: more than four bullets`);
    if ((slide.cards ?? []).length > MAX_SUPPORTS) issues.push(`slide ${n}: more than four cards`);
    if ((slide.metrics ?? []).length > MAX_SUPPORTS) issues.push(`slide ${n}: more than four metrics`);
    if ((slide.asks ?? []).length > MAX_SUPPORTS) issues.push(`slide ${n}: more than four asks`);
    if (slide.chart && !slide.chart.categories?.length) {
      issues.push(`slide ${n}: chart has no data`);
    }
    for (const picture of slide.pictures ?? []) {
      if (!picture.prompt?.trim()) issues.push(`slide ${n}: picture ${picture.id} has no prompt`);
    }
    for (const box of slide.boxes) {
      if (box.w < 0.3 || box.h < 0.2) issues.push(`slide ${n}: a box is too small`);
    }
  }
  return issues;
}

export function validateDeck(deck: DeckIr): DeckIr {
  const title = clipTitle(deck.title || "Presentation");
  const slides = (deck.slides ?? []).slice(0, MAX_SLIDES).map((slide, index) => {
    const normalized = slideFromUnknown(slide);
    const next = {
      ...normalized,
      title: normalized.title ? clipTitle(normalized.title) : normalized.title,
      bullets: (normalized.bullets ?? []).map((b) => b.slice(0, 240)).slice(0, MAX_SUPPORTS),
      cards: (normalized.cards ?? []).slice(0, MAX_SUPPORTS),
      metrics: (normalized.metrics ?? []).slice(0, MAX_SUPPORTS),
      asks: (normalized.asks ?? []).slice(0, MAX_SUPPORTS),
      boxes: (normalized.boxes ?? []).slice(0, 16).map((box, i) => {
        const clamped = clampTextBox(box);
        return { ...clamped, id: clamped.id || `s${index}-${clamped.role}-${i}` };
      }),
      shapes: (normalized.shapes ?? []).slice(0, 16).map(clampShape),
      pictures: (normalized.pictures ?? []).slice(0, 4).map((picture, i) => clampPicture(picture, i)),
    };
    const stripped = next.layout === "big-number";
    return {
      ...next,
      image: stripped ? undefined : next.image,
      pictures: stripped ? undefined : next.pictures,
    };
  });
  return {
    ir: DECK_IR,
    title,
    audience: deck.audience,
    date: deck.date,
    background: deck.background,
    slides: slides.length ? slides : [{ layout: "title-slide", title, boxes: [] }],
  };
}

function validateReport(report: ReportIr): ReportIr {
  return {
    ir: REPORT_IR,
    title: clipTitle(report.title || "Document"),
    audience: report.audience,
    kind: report.kind,
    date: report.date,
    sections: (report.sections ?? []).slice(0, 30).map((s) => ({
      heading: clipTitle(s.heading || "Section"),
      body: s.body,
      bullets: (s.bullets ?? []).slice(0, 12),
      table: s.table,
    })),
  };
}

export function knownLayout(layout: string | undefined): SlideLayout {
  if (layout && (OFFICE_LAYOUTS as readonly string[]).includes(layout)) return layout as SlideLayout;
  if (layout && LEGACY_LAYOUT[layout]) return LEGACY_LAYOUT[layout]!;
  return "title-and-body";
}

function legacyDeck(args: Record<string, unknown>): DeckIr {
  const title = clipTitle(asString(args.title) || asString(args.name) || "Presentation");
  const listed = asArray(args.slides);
  const slides: SlideIr[] = [
    { layout: "title-slide", title, kicker: "Briefing", subtitle: asString(args.audience), boxes: [] },
  ];
  if (listed.length) {
    for (const item of listed) slides.push(slideFromUnknown(item));
  } else {
    const body = asString(args.body) || asString(args.content) || asString(args.outline);
    if (body) {
      for (const fromMd of slidesFromMarkdown(body, title)) slides.push(fromMd);
    }
  }
  return {
    ir: DECK_IR,
    title,
    audience: asString(args.audience) || undefined,
    date: asString(args.date) || undefined,
    slides,
  };
}

function slideFromUnknown(item: unknown): SlideIr {
  if (typeof item === "string") {
    const lines = item.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return {
      layout: "title-and-body",
      title: clipTitle(lines[0] || "Slide"),
      bullets: lines.slice(1).map((l) => l.replace(/^[-*]\s+/, "")).slice(0, MAX_SUPPORTS),
      boxes: [],
    };
  }
  if (!item || typeof item !== "object") return { layout: "title-and-body", title: "Slide", boxes: [] };
  const rec = item as Record<string, unknown>;
  const chart = chartFromUnknown(rec.chart) ?? chartFromUnknown(rec);
  return {
    layout: knownLayout(asString(rec.layout)),
    title: asString(rec.title) || asString(rec.heading) || undefined,
    kicker: asString(rec.kicker) || undefined,
    subtitle: asString(rec.subtitle) || undefined,
    bullets: (() => {
      const listed = asStringList(rec.bullets ?? rec.points);
      if (listed.length) return listed.slice(0, MAX_SUPPORTS);
      const body = asString(rec.body);
      return body ? [body] : [];
    })(),
    cards: asCards(rec.cards, rec),
    metrics: asMetrics(rec.metrics),
    asks: asAsks(rec),
    quote: asString(rec.quote) || undefined,
    image: imageFromUnknown(rec.image),
    chart,
    background: backgroundFromUnknown(rec.background),
    boxes: asArray(rec.boxes).map(textBoxFromUnknown).filter((b): b is TextBox => Boolean(b)),
    shapes: asArray(rec.shapes).map(shapeFromUnknown).filter((s): s is ShapeMark => Boolean(s)),
    pictures: asArray(rec.pictures).map(pictureFromUnknown).filter((p): p is Picture => Boolean(p)),
  };
}

function chartFromUnknown(value: unknown): ChartSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const type = asString(rec.type ?? rec.chart_type ?? rec.chartType);
  const categories = asStringList(rec.categories ?? rec.labels);
  const seriesRaw = Array.isArray(rec.series) ? rec.series : [];
  const series = seriesRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const s = item as Record<string, unknown>;
      const values = Array.isArray(s.values)
        ? s.values.map((v) => Number(v)).filter((n) => Number.isFinite(n))
        : [];
      return { name: asString(s.name) || "Series", values };
    })
    .filter((s) => s.values.length);
  if (!categories.length || !series.length) return undefined;
  return {
    type: type === "line" || type === "pie" ? type : "bar",
    categories,
    series,
    x: asNum(rec.x) || undefined,
    y: asNum(rec.y) || undefined,
    w: asNum(rec.w) || undefined,
    h: asNum(rec.h) || undefined,
  };
}

function imageFromUnknown(value: unknown): ImageSlot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const kind = asString(rec.kind) === "generate" ? "generate" : "none";
  return { kind, prompt: asString(rec.prompt) || undefined };
}

function backgroundFromUnknown(value: unknown): Background | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const fill = hexColor(rec.fill);
  const image = rec.image && typeof rec.image === "object" ? (rec.image as Record<string, unknown>) : undefined;
  const prompt = image ? asString(image.prompt) : "";
  const id = image ? asString(image.id) : "";
  if (!fill && !prompt) return undefined;
  return {
    fill,
    image: prompt ? { id: id || "bg", prompt } : undefined,
  };
}

function textBoxFromUnknown(item: unknown): TextBox | null {
  const box = rawBox(item);
  if (!box || !item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const text = asString(rec.text);
  if (!text) return null;
  const role = asString(rec.role);
  return {
    ...box,
    id: asString(rec.id) || undefined,
    role: isTextRole(role) ? role : "body",
    text,
    fontSize: asNum(rec.fontSize) || undefined,
    bold: rec.bold === true,
    color: hexColor(rec.color),
    align: rec.align === "center" || rec.align === "right" ? rec.align : "left",
    valign: rec.valign === "middle" || rec.valign === "bottom" ? rec.valign : "top",
  };
}

function pictureFromUnknown(item: unknown): Picture | null {
  const box = rawBox(item);
  if (!box || !item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const prompt = asString(rec.prompt);
  if (!prompt) return null;
  return {
    ...box,
    id: asString(rec.id) || "picture",
    prompt,
    role: asString(rec.role) === "background" ? "background" : "picture",
  };
}

function shapeFromUnknown(item: unknown): ShapeMark | null {
  const box = rawBox(item);
  if (!box || !item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const kind = asString(rec.kind);
  if (kind !== "rect" && kind !== "ellipse" && kind !== "line") return null;
  return {
    ...box,
    kind,
    fill: hexColor(rec.fill),
    color: hexColor(rec.color),
  };
}

function rawBox(item: unknown): Box | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const w = asNum(rec.w);
  const h = asNum(rec.h);
  if (w <= 0 || h <= 0) return null;
  return { x: asNum(rec.x), y: asNum(rec.y), w, h };
}

function clampBox(box: Box): Box {
  const x = clamp(box.x, 0, SLIDE_W - 0.3);
  const y = clamp(box.y, 0, SLIDE_H - 0.2);
  return {
    x,
    y,
    w: clamp(box.w, 0.3, SLIDE_W - x),
    h: clamp(box.h, 0.2, SLIDE_H - y),
  };
}

function clampTextBox(box: TextBox): TextBox {
  return {
    ...box,
    ...clampBox(box),
    fontSize: box.fontSize ? clamp(box.fontSize, 10, 72) : undefined,
    color: box.color,
  };
}

function clampShape(shape: ShapeMark): ShapeMark {
  return { ...shape, ...clampBox(shape) };
}

function clampPicture(picture: Picture, index: number): Picture {
  return {
    ...picture,
    ...clampBox(picture),
    id: picture.id || `p${index}`,
  };
}

function sectionFromUnknown(item: unknown): ReportSection {
  if (!item || typeof item !== "object") return { heading: "Section" };
  const rec = item as Record<string, unknown>;
  return {
    heading: asString(rec.heading) || asString(rec.title) || "Section",
    body: asString(rec.body) || asString(rec.text) || undefined,
    bullets: asStringList(rec.bullets),
    table: Array.isArray(rec.table)
      ? rec.table.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "")) : [String(row)]))
      : undefined,
  };
}

function slidesFromMarkdown(body: string, deckTitle: string): SlideIr[] {
  const slides: SlideIr[] = [];
  let current: SlideIr = { layout: "title-and-body", title: deckTitle, bullets: [], boxes: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if ((current.bullets ?? []).length || slides.length) slides.push(current);
      current = {
        layout: "title-and-body",
        title: clipTitle(line.replace(/^#+\s*/, "") || deckTitle),
        bullets: [],
        boxes: [],
      };
    } else {
      current.bullets = [...(current.bullets ?? []), line.replace(/^[-*]\s+/, "").slice(0, 240)].slice(
        0,
        MAX_SUPPORTS,
      );
    }
  }
  if ((current.bullets ?? []).length || slides.length === 0) slides.push(current);
  return slides;
}

function cardFromUnknown(item: unknown): { title: string; body: string } | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const status = asString(rec.status);
  const body =
    asString(rec.body) || asString(rec.text) || asStringList(rec.items ?? rec.bullets).join("\n");
  const title = asString(rec.title) || asString(rec.heading);
  if (!title && !body && !status) return null;
  return {
    title: title || "Card",
    body: [status, body].filter(Boolean).join("\n"),
  };
}

function asCards(
  value: unknown,
  slide?: Record<string, unknown>,
): Array<{ title: string; body: string }> {
  const fromList = Array.isArray(value)
    ? value.map(cardFromUnknown).filter((c): c is { title: string; body: string } => Boolean(c))
    : [];
  if (fromList.length) return fromList.slice(0, MAX_SUPPORTS);
  if (!slide) return [];
  return [slide.card1, slide.card2, slide.card3, slide.card4, slide.left, slide.right, slide.leftCard, slide.rightCard]
    .map(cardFromUnknown)
    .filter((c): c is { title: string; body: string } => Boolean(c))
    .slice(0, MAX_SUPPORTS);
}

function asAsks(rec: Record<string, unknown>): string[] {
  const listed = asStringList(rec.asks);
  if (listed.length) return listed.slice(0, MAX_SUPPORTS);
  const decision = asString(rec.decision) || asString(rec.ask);
  const owner = asString(rec.owner);
  const deadline = asString(rec.deadline);
  const next = asStringList(rec.next_steps ?? rec.nextSteps ?? rec.next);
  return [
    ...(decision ? [decision] : []),
    ...(owner ? [`Owner: ${owner}`] : []),
    ...(deadline ? [`By ${deadline}`] : []),
    ...next,
  ].slice(0, MAX_SUPPORTS);
}

function asMetrics(
  value: unknown,
): Array<{ label: string; value: string; owner?: string; detail?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const rec = item as Record<string, unknown>;
      return {
        label: asString(rec.label) || asString(rec.name) || "Metric",
        value: asString(rec.value) || asString(rec.amount) || "—",
        owner: asString(rec.owner) || undefined,
        detail: asString(rec.detail) || asString(rec.note) || asString(rec.delta) || asString(rec.subtext) || undefined,
      };
    })
    .slice(0, MAX_SUPPORTS);
}

export function isTextRole(value: string): value is TextRole {
  return value === "title" || value === "subtitle" || value === "body" || value === "caption" || value === "kicker" || value === "number";
}

function hexColor(value: unknown): string | undefined {
  const raw = asString(value).replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(raw)) return raw;
  return undefined;
}

function asNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).filter(Boolean);
  return [];
}

function clipTitle(value: string): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (!one) return "Untitled";
  return one.length <= TITLE_CAP ? one : `${one.slice(0, TITLE_CAP - 1).trimEnd()}…`;
}
