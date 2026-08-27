/**
 * The continuing companion thread, and how voice decides which work it belongs to.
 *
 * Companion is one conversation, not a new session per visit. Voice talks to
 * the work on screen when there is one, otherwise to that same companion id —
 * never a disconnected `"live"` that cannot appear in the list.
 */
export const COMPANION_SESSION_ID = "companion";

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

export function resolveVoiceSessionId(pathname: string): string {
  return workIdFromPath(pathname) ?? COMPANION_SESSION_ID;
}
