/**
 * Work threads and companion chats are different lists.
 *
 * Companion is session-bounded: plus starts a new chat, previous chats reopen
 * one. Voice talks to the work on screen when there is one, otherwise to the
 * companion chat that is currently open — never a disconnected `"live"` that
 * cannot appear in the list.
 */
export const COMPANION_SESSION_ID = "companion";
export const COMPANION_SESSION_KEY = "atw:companion-session";

export function readCompanionSessionId(): string {
  try {
    const stored = localStorage.getItem(COMPANION_SESSION_KEY)?.trim();
    if (stored) return stored;
  } catch {
    /* private windows */
  }
  return COMPANION_SESSION_ID;
}

export function persistCompanionSessionId(id: string): void {
  try {
    localStorage.setItem(COMPANION_SESSION_KEY, id);
  } catch {
    /* private windows */
  }
}

export function workIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/app\/(?:sessions|work)\/([^/]+)/);
  if (!match?.[1]) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id || null;
  } catch {
    return null;
  }
}

export function resolveVoiceSessionId(
  pathname: string,
  companionId = COMPANION_SESSION_ID,
): string {
  return workIdFromPath(pathname) ?? companionId;
}
