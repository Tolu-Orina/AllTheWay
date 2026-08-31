/**
 * Work threads, companion chats, and spoken sessions are different lists.
 *
 * Companion is session-bounded: plus starts a new chat, previous chats reopen
 * one. Voice never uses the typed companion thread. Speak from a work URL
 * talks to that work. Everywhere else, each Speak tap from idle is a new
 * spoken session. The last voice id is not reused; Previous is how you reopen.
 */
export const COMPANION_SESSION_ID = "companion";
export const COMPANION_SESSION_KEY = "atw:companion-session";
export const VOICE_SESSION_KEY = "atw:voice-session";

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

export function readVoiceSessionId(): string {
  try {
    return localStorage.getItem(VOICE_SESSION_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function persistVoiceSessionId(id: string): void {
  try {
    localStorage.setItem(VOICE_SESSION_KEY, id);
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
  voiceId = "",
): string {
  return workIdFromPath(pathname) ?? voiceId;
}
