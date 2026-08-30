/**
 * Last compose-form flush for a session, so Yes (click, typed, or spoken)
 * writes the edited fields before the stored plan is claimed.
 */

const flushes = new Map<string, () => Promise<void>>();

export function setComposeFlush(sessionId: string, flush: () => Promise<void>): () => void {
  if (!sessionId) return () => {};
  flushes.set(sessionId, flush);
  return () => {
    if (flushes.get(sessionId) === flush) flushes.delete(sessionId);
  };
}

export async function flushCompose(sessionId: string): Promise<void> {
  const flush = flushes.get(sessionId);
  if (flush) await flush();
}
