/**
 * Which tab is the meeting, and whether we may open a socket to the gateway.
 *
 * ## Targeting the meeting, not whichever tab happens to be focused
 *
 * Clicking the icon while AllTheWay is in front used to capture the product
 * tab. The meeting is a Meet / Zoom web / Teams web tab. Prefer the one that
 * is currently audible; if none is, refuse rather than guess at a random tab.
 *
 * Host permissions for those sites let `tabs.query({ url })` see their URLs
 * without the broad `tabs` permission. Meet also gets a content script that
 * reads caption names Meet already showed, disclosed in the listing. It does
 * not invent a name.

 *
 * ## Gateway origin
 *
 * Required host permissions are AllTheWay itself plus the meeting sites.
 * Cloud Run and localhost live in `optional_host_permissions`, and are asked
 * for on Start from the exact origin the signed-in page handed over. A
 * wildcard over every `*.run.app` service would be the first thing a store
 * reviewer asked about.
 */

export const MEETING_URL_PATTERNS = [
  "https://meet.google.com/*",
  "https://zoom.us/*",
  "https://*.zoom.us/*",
  "https://teams.microsoft.com/*",
  "https://*.teams.microsoft.com/*",
  "https://teams.live.com/*",
];

export const ALLTHEWAY_URL_PATTERNS = [
  "https://alltheway.rinegansolutions.com/*",
  "https://alltheway-prod.web.app/*",
  "http://localhost:*/*",
  "http://127.0.0.1:*/*",
];

export function isMeetingUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "meet.google.com" || host.endsWith(".meet.google.com")) return true;
    if (host === "zoom.us" || host.endsWith(".zoom.us")) return true;
    if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) return true;
    if (host === "teams.live.com" || host.endsWith(".teams.live.com")) return true;
    return false;
  } catch {
    return false;
  }
}

export async function findMeetingTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isMeetingUrl(active.url)) return active;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: MEETING_URL_PATTERNS });
  } catch {
    tabs = [];
  }

  const candidates = tabs.filter((tab) => typeof tab.id === "number");
  if (!candidates.length) return null;

  const audible = candidates.filter((tab) => tab.audible);
  const pool = audible.length ? audible : candidates;
  pool.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return pool[0];
}

export async function ensureGatewayAccess(gateway) {
  if (typeof gateway !== "string" || !gateway) return false;

  let url;
  try {
    url = new URL(gateway);
  } catch {
    return false;
  }

  const http = `${url.protocol}//${url.host}/*`;
  const ws = http.replace(/^http/, "ws");
  const origins = [http, ws];

  try {
    if (await chrome.permissions.contains({ origins })) return true;
  } catch {
    // An origin not named in optional_host_permissions throws rather than
    // returning false. Treat that as "we must ask".
  }

  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}
