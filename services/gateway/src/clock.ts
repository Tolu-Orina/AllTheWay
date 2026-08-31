/**
 * IANA clock, not a map pin.
 *
 * ## What this is
 *
 * The instant, the person's zone, and — when it differs — their calendar's
 * zone. "What time is it" and "where am I" are this. GPS and IP geolocation
 * are not in the product.
 *
 * ## Two zones, named
 *
 * Device (or an override they set) answers "what time is it". Calendar
 * questions and new events use the calendar zone. When the two disagree they
 * flew with the calendar still at home; CLOCK says so once rather than
 * silently picking one.
 */

export type ClockSource = "device" | "calendar" | "override";

export type StoredClock = {
  source: ClockSource;
  deviceTimeZone: string;
  calendarTimeZone: string;
  overrideTimeZone: string;
};

export type ResolvedClock = {
  nowTimeZone: string;
  calendarTimeZone: string;
  deviceTimeZone: string;
  source: ClockSource;
  differ: boolean;
};

const FALLBACK_ZONE = "UTC";

export function isIanaTimeZone(value: string): boolean {
  const zone = value.trim();
  if (!zone || zone.length > 80 || zone.includes("..")) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function asIanaTimeZone(value: unknown): string {
  return typeof value === "string" && isIanaTimeZone(value) ? value.trim() : "";
}

export function resolveClock(stored: Partial<StoredClock>): ResolvedClock {
  const device = asIanaTimeZone(stored.deviceTimeZone);
  const calendar = asIanaTimeZone(stored.calendarTimeZone);
  const override = asIanaTimeZone(stored.overrideTimeZone);
  const source: ClockSource =
    stored.source === "override" && override
      ? "override"
      : device
        ? "device"
        : calendar
          ? "calendar"
          : "device";

  const nowTimeZone =
    source === "override" ? override : device || calendar || FALLBACK_ZONE;
  const calendarTimeZone =
    source === "override" ? override : calendar || device || FALLBACK_ZONE;

  return {
    nowTimeZone,
    calendarTimeZone,
    deviceTimeZone: device,
    source,
    differ: nowTimeZone !== calendarTimeZone,
  };
}

function partsInZone(
  at: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

/** UTC instant whose wall clock in `timeZone` is `hour:minute` on that local date. */
export function instantAtWall(
  near: Date,
  timeZone: string,
  hour: number,
  minute: number,
): Date {
  const { year, month, day } = partsInZone(near, timeZone);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const shown = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(guess));
  const [sh, sm] = shown.split(":").map(Number);
  const driftMin = (hour - (sh ?? 0)) * 60 + (minute - (sm ?? 0));
  return new Date(guess + driftMin * 60_000);
}

function isoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function startOfDayInZone(now: Date, timeZone: string): string {
  const zone = isIanaTimeZone(timeZone) ? timeZone.trim() : FALLBACK_ZONE;
  return isoZ(instantAtWall(now, zone, 0, 0));
}

export function startOfYesterdayInZone(now: Date, timeZone: string): string {
  const zone = isIanaTimeZone(timeZone) ? timeZone.trim() : FALLBACK_ZONE;
  const start = instantAtWall(now, zone, 0, 0);
  return startOfDayInZone(new Date(start.getTime() - 12 * 60 * 60 * 1000), zone);
}

function sourceLabel(source: ClockSource): string {
  if (source === "override") return "you set this";
  if (source === "calendar") return "from your calendar";
  return "from this device";
}

function weekdayAndTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/**
 * The CLOCK block the planner and the live model both see.
 *
 * Starts with `CLOCK:` so a legacy ISO instant and this paragraph are
 * distinguishable in the orchestrator.
 */
export function clockPrompt(resolved: ResolvedClock, now = new Date()): string {
  const instant = now.toISOString();
  const here = weekdayAndTime(now, resolved.nowTimeZone);
  const lines = [
    `CLOCK: the current instant is ${instant} (UTC).`,
    `It is ${here}, ${resolved.nowTimeZone} (${sourceLabel(resolved.source)}).`,
  ];
  if (resolved.differ) {
    lines.push(
      `Your calendar is ${resolved.calendarTimeZone}. Calendar questions and new events use that zone. "What time is it" and "where am I" use ${resolved.nowTimeZone}.`,
    );
  } else {
    lines.push(
      `Calendar questions and new events use ${resolved.calendarTimeZone} unless they named a zone.`,
    );
  }
  lines.push(
    'UK/London/Britain means Europe/London if they named it. "Where am I" is this time zone and its source — never a map pin, never a city guessed from their accent.',
  );
  return lines.join(" ");
}

/** The HTTP and contracts shape: `timeZone` is what "what time is it" uses. */
export function clockWire(resolved: ResolvedClock) {
  return {
    timeZone: resolved.nowTimeZone,
    calendarTimeZone: resolved.calendarTimeZone,
    deviceTimeZone: resolved.deviceTimeZone,
    source: resolved.source,
    differ: resolved.differ,
  };
}
