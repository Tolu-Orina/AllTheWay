/**
 * Layout IR for decks and reports.
 *
 * The planner chooses the story (which layout, whether a slide needs an image).
 * The compiler owns coordinates. An LLM placing x/y is how text overlaps.
 */

export const DECK_IR = "deck.v1";
export const REPORT_IR = "report.v1";
export const MAX_SLIDES = 20;
export const MAX_CRITIQUE_ROUNDS = 6;
export const MAX_IMAGES = 8;
export const MIN_IMAGES = 3;
export const MAX_SUPPORTS = 4;
export const VISUAL_PASS_SCORE = 95;

export type ImageSlot = {
  kind: "generate" | "none";
  prompt?: string;
};

export type ChartSpec = {
  type: "bar" | "line" | "pie";
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
};

export type SlideLayout =
  | "title"
  | "two-card"
  | "metric-row"
  | "split-visual"
  | "photo-story"
  | "chart"
  | "closing-ask"
  | "quote"
  | "agenda"
  | "bullets";

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
};

export type DeckIr = {
  ir: typeof DECK_IR;
  title: string;
  audience?: string;
  date?: string;
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

export function imageSlots(deck: DeckIr): Array<{ index: number; prompt: string }> {
  const out: Array<{ index: number; prompt: string }> = [];
  deck.slides.forEach((slide, index) => {
    if (slide.image?.kind === "generate" && slide.image.prompt?.trim()) {
      out.push({ index, prompt: slide.image.prompt.trim() });
    }
  });
  return out.slice(0, MAX_IMAGES);
}

/**
 * Every deck gets at least three generate slots after Yes. The planner should
 * have named them; this is the backstop so a chart-only IR still ships photos.
 * Never on chart or metric-row — those are numbers.
 */
export function ensureDeckImages(deck: DeckIr): DeckIr {
  const slides: SlideIr[] = deck.slides.map((slide) => ({
    ...slide,
    image:
      slide.layout === "chart" || slide.layout === "metric-row"
        ? undefined
        : slide.image
          ? { ...slide.image }
          : undefined,
  }));

  const count = () =>
    slides.filter((s) => s.image?.kind === "generate" && s.image.prompt?.trim()).length;

  const promptFor = (role: string, slide: SlideIr): string =>
    [
      "Professional editorial photograph for a board PowerPoint.",
      "Photorealistic, cinematic lighting, 16:9.",
      "No text, no logos, no watermarks, no charts, no UI, no numbers.",
      role,
      `Deck: ${deck.title}.`,
      slide.title ? `This slide is “${slide.title}”.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const setImage = (slide: SlideIr, role: string): void => {
    if (slide.image?.kind === "generate" && slide.image.prompt?.trim()) return;
    if (slide.layout === "chart" || slide.layout === "metric-row") return;
    slide.image = { kind: "generate", prompt: promptFor(role, slide) };
  };

  if (slides[0]) {
    setImage(slides[0], "Hero establishing scene for the cover — the world this decision lives in");
  }

  for (const slide of slides) {
    if (count() >= MIN_IMAGES) break;
    if (slide.layout === "bullets" || slide.layout === "agenda") {
      slide.layout = "split-visual";
      setImage(slide, "Photograph that illustrates these points — product, place, or people, not a diagram");
    }
  }

  for (const slide of slides) {
    if (count() >= MIN_IMAGES) break;
    if (slide.layout === "split-visual" || slide.layout === "photo-story") {
      setImage(slide, "Supporting photograph that carries this slide’s point");
    }
  }

  for (const slide of slides) {
    if (count() >= MIN_IMAGES) break;
    setImage(slide, "Supporting editorial photograph that belongs on this slide");
  }

  while (count() < MIN_IMAGES && slides.length < MAX_SLIDES) {
    const insertAt = Math.min(slides.length, Math.max(1, slides.length - 1));
    slides.splice(insertAt, 0, {
      layout: "photo-story",
      title: "The working context",
      bullets: deck.audience ? [`Prepared for ${deck.audience}`] : ["The situation this decision lives in"],
      image: {
        kind: "generate",
        prompt: promptFor(
          "Editorial photograph of the operating environment — offices, factory floor, or customers, no text",
          { layout: "photo-story", title: "The working context" },
        ),
      },
    });
  }

  return validateDeck({ ...deck, slides });
}

export function applyDeckPatch(deck: DeckIr, patch: unknown): DeckIr {
  if (!patch || typeof patch !== "object") return deck;
  const rec = patch as Record<string, unknown>;
  const next: DeckIr = {
    ...deck,
    title: asString(rec.title) || deck.title,
    audience: asString(rec.audience) || deck.audience,
    date: asString(rec.date) || deck.date,
    slides: deck.slides.map((slide) => ({ ...slide })),
  };
  const slides = asArray(rec.slides);
  if (slides.length >= deck.slides.length) {
    next.slides = slides.map(slideFromUnknown);
  } else if (slides.length) {
    const copy = deck.slides.map((slide) => ({ ...slide }));
    slides.forEach((raw, i) => {
      const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const idxRaw = Number(rec.index);
      const idx = Number.isInteger(idxRaw) ? idxRaw : i;
      if (idx < 0 || idx >= copy.length) return;
      copy[idx] = slideFromUnknown({ ...copy[idx], ...rec });
    });
    next.slides = copy;
  }
  return validateDeck(next);
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
    if (slide.layout === "chart" && !slide.chart?.categories?.length) {
      issues.push(`slide ${n}: chart has no data`);
    }
    if (
      (slide.layout === "split-visual" || slide.layout === "photo-story") &&
      slide.image?.kind === "generate" &&
      !slide.image.prompt
    ) {
      issues.push(`slide ${n}: ${slide.layout} needs an image prompt`);
    }
    if ((slide.layout === "chart" || slide.layout === "metric-row") && slide.image?.kind === "generate") {
      issues.push(`slide ${n}: ${slide.layout} must not carry a photograph`);
    }
  }
  const pictured = deck.slides.filter(
    (s) => s.image?.kind === "generate" && s.image.prompt?.trim(),
  ).length;
  if (pictured < MIN_IMAGES) {
    issues.push(`deck needs at least ${MIN_IMAGES} image slots, has ${pictured}`);
  }
  return issues;
}

function validateDeck(deck: DeckIr): DeckIr {
  const title = clipTitle(deck.title || "Presentation");
  const slides = (deck.slides ?? []).slice(0, MAX_SLIDES).map((slide) => {
    const normalized = slideFromUnknown(slide);
    return {
      ...normalized,
      title: normalized.title ? clipTitle(normalized.title) : normalized.title,
      bullets: (normalized.bullets ?? []).map((b) => b.slice(0, 240)).slice(0, MAX_SUPPORTS),
      cards: (normalized.cards ?? []).slice(0, MAX_SUPPORTS),
      metrics: (normalized.metrics ?? []).slice(0, MAX_SUPPORTS),
      asks: (normalized.asks ?? []).slice(0, MAX_SUPPORTS),
    };
  });
  return {
    ir: DECK_IR,
    title,
    audience: deck.audience,
    date: deck.date,
    slides: slides.length ? slides : [{ layout: "title", title }],
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

function knownLayout(layout: string | undefined): SlideLayout {
  const allowed: SlideLayout[] = [
    "title",
    "two-card",
    "metric-row",
    "split-visual",
    "photo-story",
    "chart",
    "closing-ask",
    "quote",
    "agenda",
    "bullets",
  ];
  if (layout && (allowed as string[]).includes(layout)) return layout as SlideLayout;
  return "bullets";
}

function legacyDeck(args: Record<string, unknown>): DeckIr {
  const title = clipTitle(asString(args.title) || asString(args.name) || "Presentation");
  const listed = asArray(args.slides);
  const slides: SlideIr[] = [{ layout: "title", title, kicker: "Briefing", subtitle: asString(args.audience) }];
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
      layout: "bullets",
      title: clipTitle(lines[0] || "Slide"),
      bullets: lines.slice(1).map((l) => l.replace(/^[-*]\s+/, "")).slice(0, MAX_SUPPORTS),
    };
  }
  if (!item || typeof item !== "object") return { layout: "bullets", title: "Slide" };
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
  };
}

function imageFromUnknown(value: unknown): ImageSlot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const kind = asString(rec.kind) === "generate" ? "generate" : "none";
  return { kind, prompt: asString(rec.prompt) || undefined };
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
  let current: SlideIr = { layout: "bullets", title: deckTitle, bullets: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if ((current.bullets ?? []).length || slides.length) slides.push(current);
      current = { layout: "bullets", title: clipTitle(line.replace(/^#+\s*/, "") || deckTitle), bullets: [] };
    } else {
      current.bullets = [...(current.bullets ?? []), line.replace(/^[-*]\s+/, "").slice(0, 240)].slice(0, MAX_SUPPORTS);
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
