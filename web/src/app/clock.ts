import { api, type Clock } from "@/app/data";

/**
 * IANA zone this device reports. Never GPS, never IP.
 *
 * Cached after a ping or a Profile save so ConfirmGate can default a new
 * event to the calendar zone without a round trip on every keystroke.
 */

let cached: Clock | null = null;

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function peekClock(): Clock | null {
  return cached;
}

export function rememberClock(clock: Clock): void {
  cached = clock;
}

/** Calendar questions and new events. Last resort is UTC, never London-as-default. */
export function calendarZone(): string {
  return peekClock()?.calendarTimeZone || deviceTimeZone() || "UTC";
}

export function reportDeviceClock(): void {
  const zone = deviceTimeZone();
  if (!zone) return;
  void api
    .setClock({ timeZone: zone, source: "ping" })
    .then(rememberClock)
    .catch(() => {
      /* a missed ping must not block sign-in */
    });
}

export function ianaZones(): string[] {
  const device = deviceTimeZone();
  let values: string[] = [];
  try {
    values = [...Intl.supportedValuesOf("timeZone")];
  } catch {
    values = [
      "UTC",
      "Europe/London",
      "Europe/Paris",
      "America/New_York",
      "America/Los_Angeles",
      "America/Sao_Paulo",
      "Africa/Lagos",
      "Africa/Johannesburg",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Pacific/Auckland",
    ];
  }
  if (device && !values.includes(device)) values.unshift(device);
  return values;
}
