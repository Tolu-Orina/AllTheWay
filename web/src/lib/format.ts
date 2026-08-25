const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60],
  ["month", 30 * 24 * 60],
  ["day", 24 * 60],
  ["hour", 60],
  ["minute", 1],
];

/**
 * "12 minutes ago" from an ISO timestamp.
 *
 * The gateway returns ISO-8601 and never a pre-formatted string: how a time
 * reads is a client concern, and it has to respect the viewer's locale.
 */
export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (Math.abs(minutes) < 1) return "just now";

  for (const [unit, perUnit] of UNITS) {
    if (Math.abs(minutes) >= perUnit) {
      return rtf.format(Math.round(minutes / perUnit), unit);
    }
  }
  return rtf.format(minutes, "minute");
}

/** "09:14" for a run timestamp. */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}
