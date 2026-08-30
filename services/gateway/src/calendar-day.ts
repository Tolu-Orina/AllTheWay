import type { Day, DayItem, Hat, Place, Rhythm } from "@alltheway/contracts";

import { runReadTool } from "./voice/tools.js";
import { listPeople, listPlaces, listRhythms } from "./repos/life.js";

/**
 * The next twelve hours, from the calendar she already connected and from
 * rhythms she named. No model. A missed pickup is worse than a clever summary.
 */

const WINDOW_MS = 12 * 60 * 60 * 1000;
const DEFAULT_BUFFER_MIN = 15;

export function hatFromTitle(title: string): Hat {
  const t = title.toLowerCase();
  if (/\b(church|choir|sermon|worship|sunday school|bible|parish)\b/.test(t)) return "church";
  if (
    /\b(school|pickup|pick-up|drop-?off|soccer|football|ballet|piano|swim|kids?|child)\b/.test(
      t,
    )
  ) {
    return "home";
  }
  return "work";
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function occurrencesInWindow(
  rhythm: Rhythm,
  from: Date,
  until: Date,
): Date[] {
  const [hStr, mStr] = rhythm.time.split(":");
  const hour = Number(hStr);
  const minute = Number(mStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return [];

  const found: Date[] = [];
  // Walk local midnights in the rhythm's zone by stepping UTC hours.
  for (let t = from.getTime() - 36 * 60 * 60 * 1000; t <= until.getTime() + 36 * 60 * 60 * 1000; t += 60 * 60 * 1000) {
    const candidate = wallTimeInZone(new Date(t), rhythm.timeZone, hour, minute);
    if (candidate < from || candidate >= until) continue;
    const day = weekdayInZone(candidate, rhythm.timeZone);
    if (!rhythm.weekdays.includes(day)) continue;
    if (!found.some((x) => x.getTime() === candidate.getTime())) found.push(candidate);
  }
  return found.sort((a, b) => a.getTime() - b.getTime());
}

function weekdayInZone(at: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

function wallTimeInZone(near: Date, timeZone: string, hour: number, minute: number): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(near);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  // Interpret the wall clock as ISO without offset, then find the UTC instant
  // whose zone formatting matches. Binary-search is overkill; try the UTC
  // guess and correct by the observed offset.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const shown = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(guess));
  const [sh, sm] = shown.split(":").map(Number);
  const driftMin = (hour - sh) * 60 + (minute - sm);
  return new Date(guess + driftMin * 60_000);
}

function parseEventsJson(raw: string): Array<{ id: string; title: string; startsAt: string }> {
  try {
    const parsed = JSON.parse(raw) as { events?: unknown; error?: string };
    if (parsed.error || !Array.isArray(parsed.events)) return [];
    return parsed.events.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const rec = row as Record<string, unknown>;
      const id = String(rec.id ?? "");
      const title = String(rec.title ?? "").trim() || "(no title)";
      const startsAt = String(rec.startsAt ?? "");
      if (!id || !startsAt) return [];
      return [{ id, title, startsAt }];
    });
  } catch {
    return [];
  }
}

/**
 * Assemble a Day from pre-fetched local data and a resolved calendar result.
 *
 * Used by both `buildDay` (which fetches everything itself) and `buildHome`
 * (which already has places/rhythms/people and wants a calendar-free snapshot
 * that responds without waiting for the external API).
 */
export function buildDayFromParts(
  places: Place[],
  rhythms: Rhythm[],
  people: Array<{ id: string; name: string }>,
  calendar: { status: Day["calendar"]; events: Array<{ id: string; title: string; startsAt: string }> },
  now: Date,
): Day {
  const until = new Date(now.getTime() + WINDOW_MS);

  const placeById = new Map(places.map((p) => [p.id, p]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const items: DayItem[] = [];

  if (calendar.status === "connected") {
    for (const event of calendar.events) {
      const start = new Date(event.startsAt);
      if (Number.isNaN(start.getTime()) || start < now || start >= until) continue;
      items.push({
        id: `cal:${event.id}`,
        title: event.title,
        startsAt: iso(start),
        hat: hatFromTitle(event.title),
        source: "calendar",
        personName: "",
        leaveAt: iso(new Date(start.getTime() - DEFAULT_BUFFER_MIN * 60_000)),
        placeLabel: "",
      });
    }
  }

  for (const rhythm of rhythms) {
    const place: Place | undefined = rhythm.placeId ? placeById.get(rhythm.placeId) : undefined;
    const buffer = place?.bufferMinutes ?? DEFAULT_BUFFER_MIN;
    for (const start of occurrencesInWindow(rhythm, now, until)) {
      items.push({
        id: `rhythm:${rhythm.id}:${start.getTime()}`,
        title: rhythm.title,
        startsAt: iso(start),
        hat: rhythm.hat,
        source: "rhythm",
        personName: rhythm.personId ? (personById.get(rhythm.personId)?.name ?? "") : "",
        leaveAt: iso(new Date(start.getTime() - buffer * 60_000)),
        placeLabel: place?.label ?? "",
      });
    }
  }

  items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const upcomingLeave = items
    .filter((row) => row.leaveAt && new Date(row.leaveAt).getTime() >= now.getTime())
    .sort((a, b) => (a.leaveAt ?? "").localeCompare(b.leaveAt ?? ""))[0];

  return {
    calendar: calendar.status,
    hours: items,
    nextLeave: upcomingLeave?.leaveAt
      ? {
          title: upcomingLeave.title,
          leaveAt: upcomingLeave.leaveAt,
          minutes: Math.max(
            0,
            Math.round((new Date(upcomingLeave.leaveAt).getTime() - now.getTime()) / 60_000),
          ),
        }
      : null,
  };
}

export async function buildDay(uid: string, now = new Date()): Promise<Day> {
  const [places, rhythms, people, calendar] = await Promise.all([
    listPlaces(uid),
    listRhythms(uid),
    listPeople(uid),
    readCalendar(uid, now),
  ]);
  return buildDayFromParts(places, rhythms, people, calendar, now);
}

async function readCalendar(
  uid: string,
  now: Date,
): Promise<{ status: Day["calendar"]; events: Array<{ id: string; title: string; startsAt: string }> }> {
  const result = await runReadTool(uid, "whats_on_my_calendar", {
    limit: 25,
    time_min: iso(now),
  });
  if (typeof result.cannot === "string") {
    const missing = /not connected/i.test(String(result.cannot));
    return { status: missing ? "missing" : "error", events: [] };
  }
  const raw = typeof result.result === "string" ? result.result : JSON.stringify(result);
  return { status: "connected", events: parseEventsJson(rawOf(raw)) };
}

function rawOf(value: string): string {
  const trimmed = value.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return trimmed;
  return trimmed.slice(start);
}
