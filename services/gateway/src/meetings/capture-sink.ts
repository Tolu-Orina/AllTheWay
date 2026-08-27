import { authenticatingFetch } from "../a2a.js";
import { env } from "../env.js";
import type { CaptureDeps, } from "./capture.js";
import type { Utterance } from "./transcriber.js";

/**
 * Where captured utterances go: the scribe, exactly like Tier 1 and Tier 2.
 *
 * ## Why this is a thin adapter and not a second pipeline
 *
 * The scribe already turns utterances into notes, derives commitments as
 * unconfirmed proposals, keys everything by content so a replay cannot
 * duplicate it, and records coverage gaps. None of that is specific to how the
 * audio arrived.
 *
 * So Tier 1.5 is a new *source*, not a new *pipeline*. A meeting captured from
 * a tab lands in the same record, with the same commitment rules and the same
 * screening, as one read from a Meet transcript. If it had its own path, the
 * two would drift — and the half that drifted would be the one nobody tested.
 *
 * ## Utterances are batched, not sent one at a time
 *
 * A meeting produces an utterance every few seconds for ninety minutes. One
 * request each would be thousands of round trips holding an instance open; the
 * scribe already accepts up to 500 in a call.
 *
 * The flush interval is short enough that a crash loses seconds rather than
 * minutes, and the buffer is bounded — if the scribe is unreachable the oldest
 * utterances are dropped rather than growing until the instance dies. Losing
 * the start of a meeting is bad; losing the whole service is worse.
 */

const FLUSH_MS = 15_000;
const MAX_BUFFERED = 500;

interface Pending {
  utterances: Utterance[];
  timer: NodeJS.Timeout | null;
}

export function captureToScribe(): Omit<CaptureDeps, "openTranscriber" | "runInsights"> & {
  storeInsights: (uid: string, meetingId: string, insights: unknown[]) => Promise<void>;
} {
  const pending = new Map<string, Pending>();

  const key = (uid: string, meetingId: string) => `${uid}::${meetingId}`;

  async function post(path: string, uid: string, body: unknown): Promise<void> {
    if (!env.scribeUrl) return;
    const fetchImpl = authenticatingFetch(env.scribeUrl);
    await fetchImpl(`${env.scribeUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The uid travels as a header to an internal-only service, never in the
        // body — the same rule as every other hop to the scribe.
        "X-User-Id": uid,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async function flush(uid: string, meetingId: string): Promise<void> {
    const entry = pending.get(key(uid, meetingId));
    if (!entry || entry.utterances.length === 0) return;

    const batch = entry.utterances.splice(0, entry.utterances.length);
    try {
      await post("/meetings/notes", uid, { meetingId, utterances: batch });
    } catch {
      // Deliberately not requeued. A retry that fails the same way turns one
      // unreachable scribe into an unbounded buffer, and the notes that matter
      // most are the ones still arriving.
    }
  }

  return {
    /**
     * Kept as well as streamed.
     *
     * Delivered only over the capture socket, an insight could be read by the
     * extension and nowhere else — so a phone could never show one, and neither
     * could the meeting afterwards. That matters more than it first appears:
     * while screen-sharing, the side panel is visible to the whole room.
     */
    async storeInsights(uid, meetingId, insights) {
      if (insights.length === 0) return;
      await post("/meetings/insights", uid, { meetingId, insights }).catch(() => {
        // A stored insight that fails to store is not worth interrupting a
        // meeting over; it was already delivered live.
      });
    },

    async onOpen(uid, meetingId, title) {
      pending.set(key(uid, meetingId), { utterances: [], timer: null });

      // Tier 0 in the ladder's terms: nothing was refused, because nothing was
      // attempted — the user is capturing it themselves. Recorded as its own
      // tier so the meeting says how it was heard.
      await post("/meetings/start", uid, {
        meetingId,
        spaceName: title,
        conferenceId: meetingId,
        participants: [],
        capturedLocally: true,
      }).catch(() => {});
    },

    async onUtterance(uid, meetingId, utterance) {
      const id = key(uid, meetingId);
      const entry = pending.get(id) ?? { utterances: [], timer: null };
      pending.set(id, entry);

      entry.utterances.push(utterance);
      if (entry.utterances.length > MAX_BUFFERED) {
        // Bounded. The alternative is an instance that grows until it dies,
        // taking the rest of the meeting with it.
        entry.utterances.splice(0, entry.utterances.length - MAX_BUFFERED);
      }

      if (!entry.timer) {
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void flush(uid, meetingId);
        }, FLUSH_MS);
      }
    },

    async onClose(uid, meetingId) {
      const id = key(uid, meetingId);
      const entry = pending.get(id);
      if (entry?.timer) clearTimeout(entry.timer);

      // The final flush is awaited, unlike the periodic ones: whatever was said
      // in the last few seconds is often the part with the commitments in it.
      await flush(uid, meetingId);
      pending.delete(id);

      await post("/meetings/end", uid, { meetingId }).catch(() => {});
    },
  };
}
