/**
 * Speaker labels that already exist somewhere else.
 *
 * Keep in step with `services/gateway/src/meetings/speaker.ts`. The two
 * services cannot import each other; a resource path rendered as a person
 * is worse than two copies of the same fail-closed rule.
 */

export type Caption = { speaker?: string; text: string };

export function normalizeSpoken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function captionMatchesUtterance(utterance: string, caption: string): boolean {
  const a = normalizeSpoken(utterance);
  const b = normalizeSpoken(caption);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) {
    const shorter = a.length < b.length ? a : b;
    return shorter.length >= 12;
  }
  return false;
}

export function isPlatformDisplayName(value: string | undefined): boolean {
  const t = (value ?? "").trim();
  if (!t || t.length > 80) return false;
  if (t.includes("/")) return false;
  if (/^(conferenceRecords|spaces|users)\b/i.test(t)) return false;
  return true;
}

export function overlayNames<T extends { at: string; text: string; speakerLabel: string }>(
  notes: T[],
  entries: Array<{ text: string; speaker?: string }>,
): T[] {
  return notes.map((note) => {
    if (note.speakerLabel !== "Unattributed") return note;
    const hit = entries.find(
      (entry) =>
        captionMatchesUtterance(note.text, entry.text) && isPlatformDisplayName(entry.speaker),
    );
    if (!hit?.speaker) return note;
    return { ...note, speakerLabel: hit.speaker.trim() };
  });
}

export function meetSpaceFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "meet.google.com" && !host.endsWith(".meet.google.com")) return undefined;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const code = parts[0] === "lookup" ? undefined : parts[0];
  if (!code) return undefined;
  if (code === "landing" || code === "new" || code === "home") return undefined;
  if (!/^[a-z0-9][a-z0-9-]{2,}$/i.test(code)) return undefined;
  return code;
}

export function looksLikeMeetSpace(value: string): boolean {
  const t = value.trim();
  if (!t || t.includes("/")) return false;
  return /^[a-z0-9][a-z0-9-]{2,}$/i.test(t) && !t.startsWith("tab-");
}
