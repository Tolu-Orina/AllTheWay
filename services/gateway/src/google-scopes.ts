/**
 * Google connector scopes, as this service asks for them.
 *
 * The connector gateway's catalogue.py is the authority on what a *call*
 * requires. This file is the consent-screen side: which scopes to request when
 * the person taps one row, and how to decide whether that row is connected.
 *
 * They are declared separately because the browser-facing service has no IAM
 * path to the connector gateway. The split is safe in the direction it can
 * fail: asking for too little is refused as "you have not granted this", which
 * the person can act on. It cannot silently allow anything, because nothing here
 * decides what a call may do.
 *
 * Restricted scopes are absent from the base sets — `gmail.compose` is opt-in.
 */

export const GMAIL_DRAFTS_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

export const CONNECTOR_SCOPES: Record<string, readonly string[]> = {
  google_calendar: ["https://www.googleapis.com/auth/calendar.events"],
  google_gmail: ["https://www.googleapis.com/auth/gmail.send"],
  google_drive: ["https://www.googleapis.com/auth/drive.file"],
  google_docs: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
  ],
  google_meet: [
    "https://www.googleapis.com/auth/meetings.space.readonly",
    "https://www.googleapis.com/auth/meetings.space.created",
  ],
};

export const GOOGLE_CONNECTOR_IDS = Object.keys(CONNECTOR_SCOPES);

/** One refresh token per (user, Google client). Shared by every Google connector. */
export function googleGrantId(uid: string): string {
  return `${uid}::google`;
}

export function isGoogleConnector(connector: string): boolean {
  return connector.startsWith("google_");
}

/**
 * Whether this connector's *base* scopes are all on the grant.
 *
 * A missing row is not connected. Extra scopes (gmail.compose) do not make
 * a different connector look connected.
 */
export function connectorIsConnected(connectorId: string, granted: string[]): boolean {
  const needed = CONNECTOR_SCOPES[connectorId];
  if (!needed?.length) return false;
  const have = new Set(granted);
  return needed.every((scope) => have.has(scope));
}

/**
 * Which Google rows to tick on the connections list.
 *
 * `declared` is what the person actually connected, written at callback time.
 * Extra scopes on the token (from an older union request, or from
 * `include_granted_scopes`) must not light up a row they never tapped.
 *
 * A grant with no list — written when one tap asked for every Google scope —
 * lists nothing. Inferring from those leftover scopes would keep every row
 * ticked, which is the bug this exists to close. Reconnecting one row records
 * that row only.
 */
export function listedGoogleConnectors(
  granted: string[],
  declared: string[] | undefined,
): string[] {
  if (!Array.isArray(declared)) return [];
  return declared.filter((id) => connectorIsConnected(id, granted));
}

export function scopesToRequest(connectorId: string, drafts: boolean): string[] {
  const base = CONNECTOR_SCOPES[connectorId];
  if (!base?.length) return [];
  const out = [...base];
  if (drafts && connectorId === "google_gmail") out.push(GMAIL_DRAFTS_SCOPE);
  return out;
}

/**
 * Why a Gmail draft must not run, when send is connected but compose is not.
 *
 * Missing compose must not fall back to send_email. The text stays on the
 * confirm form; they turn drafts on in Profile.
 */
export function createDraftSkipReason(granted: string[]): string | null {
  if (granted.includes(GMAIL_DRAFTS_SCOPE)) return null;
  return "Saving drafts is off. Turn on drafts in Profile. The email is still on screen — nothing was sent.";
}

/**
 * The grant object the connector gateway's enforcement layer expects.
 *
 * Firestore stores the OAuth refresh token under `{uid}::google`. That is
 * *credentials*. Enforcement wants `{ connector, tools, ceiling }`. Passing
 * the Firestore document as the grant used to parse as "no grant", so a
 * confirmed plan never ran.
 */
export function enforcementGrant(connector: string, tool: string) {
  return {
    connector,
    tools: [tool],
    ceiling: "send_after_review",
  };
}
