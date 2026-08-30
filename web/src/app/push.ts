import { getMessaging, getToken, isSupported } from "firebase/messaging";

import { firebaseApp } from "@/auth/firebase";
import { api } from "@/app/data";
import { isStandaloneDisplay } from "@/lib/standalone";

export { isStandaloneDisplay } from "@/lib/standalone";

/**
 * Web push, for the morning digest.
 *
 * ## Permission is asked for at the moment it makes sense
 *
 * Never on load. A permission prompt before anyone has seen what the product
 * does is the fastest way to a permanent "Block", and a blocked notification
 * permission cannot be re-requested — it has to be undone in browser settings,
 * which nobody does. So this is called from a control the user chose to press.
 *
 * ## Failing is normal here
 *
 * No service worker, no permission, an unsupported browser, a private window,
 * an iOS home screen that has not been added — all ordinary. Every path returns
 * a reason rather than throwing, because the caller's job is to explain, not to
 * recover.
 */

export type PushOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export function iosNeedsHomeScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !isStandaloneDisplay();
}

export async function enablePush(): Promise<PushOutcome> {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapidKey) {
    // A configuration gap, said as one. "Notifications are unavailable" would
    // send the user to their browser settings to fix something that is ours.
    return { ok: false, reason: "Notifications are not configured for this deployment." };
  }

  if (!(await isSupported().catch(() => false))) {
    return { ok: false, reason: "This browser cannot receive notifications." };
  }

  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "This browser cannot receive notifications." };
  }

  if (Notification.permission === "denied") {
    // Cannot be re-prompted. Saying where to change it is the only useful
    // thing left.
    return {
      ok: false,
      reason: "Notifications are blocked for this site. Allow them in your browser settings.",
    };
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") {
    return { ok: false, reason: "Notifications were not allowed." };
  }

  try {
    // Our own worker, not the SDK's default. It handles `push` directly and
    // pulls in nothing from a third-party origin — see the file for why.
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" },
    );

    const token = await getToken(getMessaging(firebaseApp), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) return { ok: false, reason: "No notification token was issued." };

    // Registered server-side against this user. A token is per-browser, so the
    // same person on a laptop and a phone has two, and both should ring.
    await api.registerPushToken(token);
    return { ok: true, token };
  } catch (error) {
    return {
      ok: false,
      reason: (error as { message?: string }).message ?? "Notifications could not be turned on.",
    };
  }
}
