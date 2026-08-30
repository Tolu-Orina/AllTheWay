/**
 * Which pending write is a compose form, not a summary card.
 *
 * Email Yes saves a Gmail draft. Calendar Yes creates the event. send_email is
 * a later, explicit turn and stays a warning, not this form.
 */

export type ComposeKind = "email" | "calendar" | null;

export type ComposeSource = {
  connector?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export function composeKind(sources: ComposeSource[]): ComposeKind {
  let email = false;
  let calendar = false;
  for (const s of sources) {
    const connector = s.connector || "";
    if (s.tool === "create_draft" && (!connector || connector === "google_gmail" || connector === "gmail")) {
      email = true;
    }
    if (s.tool === "create_event" && (!connector || connector === "google_calendar" || connector === "calendar")) {
      calendar = true;
    }
  }
  if (email && !calendar) return "email";
  if (calendar && !email) return "calendar";
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
  const tool = kind === "email" ? "create_draft" : "create_event";
  return (
    sources.find((s) => {
      const connector = s.connector || "";
      if (s.tool !== tool) return false;
      if (kind === "email") return !connector || connector === "google_gmail" || connector === "gmail";
      return !connector || connector === "google_calendar" || connector === "calendar";
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
