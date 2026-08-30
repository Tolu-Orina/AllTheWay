import { APP_HOME, afterAuthPath } from "@/auth/paths";

/**
 * When Google sign-in should leave the page (redirect) vs stay in a popup.
 *
 * Popup is the desktop path. On a phone, iOS Safari and installed PWAs
 * block or stall it, and the iframe round-trip is the "this takes forever"
 * report. Redirect is what Google's mobile guidance uses.
 *
 * Coarse pointer alone is not enough: a Windows laptop with a touch screen
 * matches `(pointer: coarse)` and used to be sent through a full-page
 * redirect, which is the awful laptop Google sign-in.
 */

export function prefersGoogleRedirect(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const androidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const phone =
    (window.matchMedia?.("(pointer: coarse)")?.matches ?? false) &&
    (window.matchMedia?.("(max-width: 768px)")?.matches ?? false);
  return Boolean(iOS || androidPhone || standalone || phone);
}

const AFTER_AUTH_KEY = "alltheway:after-auth";
const GOOGLE_REDIRECT_PENDING = "alltheway:google-redirect";

export function rememberAfterAuth(path: string): void {
  try {
    sessionStorage.setItem(AFTER_AUTH_KEY, afterAuthPath(path));
  } catch {
    /* private windows throw; they will land on /app */
  }
}

export function takeAfterAuth(fallback = APP_HOME): string {
  try {
    const stored = sessionStorage.getItem(AFTER_AUTH_KEY);
    if (stored) sessionStorage.removeItem(AFTER_AUTH_KEY);
    return afterAuthPath(stored, fallback);
  } catch {
    return fallback;
  }
}

const PENDING_TTL_MS = 10 * 60_000;

export function markGoogleRedirectPending(): void {
  try {
    sessionStorage.setItem(GOOGLE_REDIRECT_PENDING, String(Date.now()));
  } catch {
    /* private windows */
  }
}

export function googleRedirectPending(): boolean {
  try {
    const raw = sessionStorage.getItem(GOOGLE_REDIRECT_PENDING);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || Date.now() - ts > PENDING_TTL_MS) {
      sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearGoogleRedirectPending(): void {
  try {
    sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING);
  } catch {
    /* private windows */
  }
}
