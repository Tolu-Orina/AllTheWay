/**
 * Which pending write is a compose form, not a summary card.
 *
 * Email Yes saves a Gmail draft. Calendar Yes creates the event. Document Yes
 * writes the file. send_email is a later, explicit turn and stays a warning,
 * not this form.
 */

export type ComposeKind = "email" | "calendar" | "document" | null;

export type ComposeSource = {
  connector?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

const WORK_FILE_TOOLS = new Set([
  "create_document",
  "create_markdown",
  "create_pdf",
  "create_spreadsheet",
  "create_slides",
]);

export function isWorkFileTool(tool?: string): boolean {
  return Boolean(tool && WORK_FILE_TOOLS.has(tool));
}

export function isComposeReview(sources: ComposeSource[]): boolean {
  return composeKind(sources) !== null;
}

export function composeKind(sources: ComposeSource[]): ComposeKind {
  let email = false;
  let calendar = false;
  let document = false;
  for (const s of sources) {
    const connector = s.connector || "";
    if (s.tool === "create_draft" && (!connector || connector === "google_gmail" || connector === "gmail")) {
      email = true;
    }
    if (s.tool === "create_event") {
      calendar = true;
    }
    if (isWorkFileTool(s.tool) && (!connector || connector === "work_files")) {
      document = true;
    }
  }
  if (email && !calendar && !document) return "email";
  if (calendar && !email && !document) return "calendar";
  if (document && !email && !calendar) return "document";
  return null;
}

export function composeSources(steps?: ComposeSource[], actions?: ComposeSource[]): ComposeSource[] {
  const fromSteps = steps ?? [];
  const fromActions = actions ?? [];
  if (composeKind(fromActions)) return fromActions;
  if (composeKind(fromSteps)) return fromSteps;
  return fromSteps.length ? fromSteps : fromActions;
}

export function composeStep(sources: ComposeSource[], kind: Exclude<ComposeKind, null>): ComposeSource | null {
  if (kind === "document") {
    return (
      sources.find((s) => {
        const connector = s.connector || "";
        return isWorkFileTool(s.tool) && (!connector || connector === "work_files");
      }) ?? null
    );
  }
  const tool = kind === "email" ? "create_draft" : "create_event";
  return (
    sources.find((s) => {
      if (s.tool !== tool) return false;
      if (kind === "email") {
        const connector = s.connector || "";
        return !connector || connector === "google_gmail" || connector === "gmail";
      }
      return true;
    }) ?? null
  );
}

export function argString(arguments_: Record<string, unknown> | undefined, key: string): string {
  const value = arguments_?.[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value);
}

/**
 * The model's outline, as text a person can read and edit.
 *
 * report.v1 sections and slide bullets flatten to markdown so the chat form
 * is always a title plus a body, not a JSON dump.
 */
export function documentBodyFromArgs(arguments_: Record<string, unknown> | undefined): string {
  const args = arguments_ ?? {};
  const body = args.body;
  if (typeof body === "string" && body.trim()) return body;

  const sections = args.sections;
  if (Array.isArray(sections) && sections.length) {
    return sections
      .map((section) => {
        if (typeof section === "string") return section;
        if (!section || typeof section !== "object") return "";
        const row = section as Record<string, unknown>;
        const heading = typeof row.heading === "string" ? row.heading.trim() : "";
        const text = typeof row.body === "string" ? row.body.trim() : "";
        const bullets = Array.isArray(row.bullets)
          ? row.bullets.map((item) => `- ${String(item)}`).join("\n")
          : "";
        return [heading ? `## ${heading}` : "", text, bullets].filter(Boolean).join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }

  const slides = args.slides;
  if (Array.isArray(slides) && slides.length) {
    return slides
      .map((slide, i) => {
        if (!slide || typeof slide !== "object") return "";
        const row = slide as Record<string, unknown>;
        const title = typeof row.title === "string" && row.title.trim() ? row.title : `Slide ${i + 1}`;
        const text = typeof row.body === "string" ? row.body : "";
        const bullets = Array.isArray(row.bullets)
          ? row.bullets.map((item) => `- ${String(item)}`).join("\n")
          : "";
        return [`## ${title}`, text, bullets].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return "";
}

/** RFC 3339 or naive local → `datetime-local` value (`YYYY-MM-DDTHH:mm`). */
export function toDatetimeLocal(rfc: string): string {
  const match = rfc.trim().match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match ? match[1] : "";
}

/** `datetime-local` → naive local wall time the calendar connector accepts. */
export function fromDatetimeLocal(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  return trimmed;
}
