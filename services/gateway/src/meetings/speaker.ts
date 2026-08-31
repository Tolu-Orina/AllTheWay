/**
 * Speaker labels from a source that already named someone.
 *
 * Tab audio cannot name speakers. Meet captions and Meet REST can, when they
 * already showed a name. This module never invents one: a resource path, an
 * empty string, or a weak text match all stay Unattributed.
 */

export type Caption = { speaker: string; text: string };

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
    // A few shared words is how "yes" would label the whole room as one person.
    return shorter.length >= 12;
  }
  return false;
}

/**
 * A name a person would recognise. Meet REST participant resource names
 * (`conferenceRecords/…/participants/…`) must never render as a speaker.
 */
export function isPlatformDisplayName(value: string | undefined): boolean {
  const t = (value ?? "").trim();
  if (!t || t.length > 80) return false;
  if (t.includes("/")) return false;
  if (/^(conferenceRecords|spaces|users)\b/i.test(t)) return false;
  return true;
}

export function speakerFromCaptions(utterance: string, captions: Caption[]): string | undefined {
  for (let i = captions.length - 1; i >= 0; i -= 1) {
    const row = captions[i];
    if (!row || !isPlatformDisplayName(row.speaker)) continue;
    if (captionMatchesUtterance(utterance, row.text)) return row.speaker.trim();
  }
  return undefined;
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

/**
 * Google Meet meeting code from a tab URL. Lookup links and the landing
 * page are not a conference we can join later.
 */
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

/**
 * Phase 3b. We do not store the mixed PCM today. Inventing Speaker 1–N from
 * text would be the guessed-names path the ladder rejected. Refuse until a
 * later phase that actually keeps audio, with a recorded reason.
 */
export function diarizeMix(pcm: Uint8Array | null): { ok: false; reason: "no_stored_audio" } {
  void pcm;
  return { ok: false, reason: "no_stored_audio" };
}
