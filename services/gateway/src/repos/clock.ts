import { Timestamp } from "firebase-admin/firestore";

import {
  asIanaTimeZone,
  resolveClock,
  type ClockSource,
  type ResolvedClock,
  type StoredClock,
} from "../clock.js";
import { userDoc } from "../firestore.js";

function asSource(value: unknown): ClockSource {
  return value === "override" || value === "calendar" || value === "device" ? value : "device";
}

export async function getStoredClock(uid: string): Promise<StoredClock> {
  const doc = await userDoc(uid).collection("settings").doc("clock").get();
  const data = doc.exists ? doc.data() ?? {} : {};
  return {
    source: asSource(data.source),
    deviceTimeZone: asIanaTimeZone(data.deviceTimeZone),
    calendarTimeZone: asIanaTimeZone(data.calendarTimeZone),
    overrideTimeZone: asIanaTimeZone(data.overrideTimeZone),
  };
}

export async function getClock(uid: string): Promise<ResolvedClock> {
  try {
    return resolveClock(await getStoredClock(uid));
  } catch {
    return resolveClock({});
  }
}

export async function setClock(
  uid: string,
  input: { timeZone: string; source: "device" | "override" },
): Promise<ResolvedClock> {
  const zone = asIanaTimeZone(input.timeZone);
  if (!zone) {
    throw new Error("invalid_timezone");
  }
  const patch: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
    source: input.source,
  };
  if (input.source === "override") {
    patch.overrideTimeZone = zone;
  } else {
    patch.deviceTimeZone = zone;
    patch.overrideTimeZone = "";
    patch.source = "device";
  }
  await userDoc(uid).collection("settings").doc("clock").set(patch, { merge: true });
  return getClock(uid);
}

export async function rememberCalendarTimeZone(uid: string, zone: string): Promise<void> {
  const iana = asIanaTimeZone(zone);
  if (!iana) return;
  try {
    await userDoc(uid).collection("settings").doc("clock").set(
      { calendarTimeZone: iana, calendarUpdatedAt: Timestamp.now() },
      { merge: true },
    );
  } catch (err) {
    console.warn("[clock] calendar zone not stored", (err as Error).message);
  }
}

/**
 * A device ping. Updates the remembered device zone only.
 *
 * Must not clear an override: opening the app is not choosing "use this
 * device" — that is an explicit control on Profile.
 */
export async function rememberDeviceTimeZone(uid: string, zone: string): Promise<void> {
  const iana = asIanaTimeZone(zone);
  if (!iana) return;
  try {
    await userDoc(uid).collection("settings").doc("clock").set(
      { deviceTimeZone: iana, deviceUpdatedAt: Timestamp.now() },
      { merge: true },
    );
  } catch (err) {
    console.warn("[clock] device zone not stored", (err as Error).message);
  }
}
