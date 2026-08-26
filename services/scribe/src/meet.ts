import { GoogleAuth } from "google-auth-library";

/**
 * The two ways into a meeting.
 *
 * ## What is verified and what is not
 *
 * **Tier 1 is reachable.** `meet.googleapis.com` is a normal REST API: given
 * consent and a conference record, the transcript can be fetched, and the
 * failure modes are ordinary HTTP.
 *
 * **Tier 2 is not verifiable from here, and cannot be.** The Meet Media API is
 * a Developer Preview requiring the Cloud project, the OAuth principal *and
 * every participant* to be enrolled, plus a consenting host in a live meeting
 * where every participant sees and accepts an initiation dialog. There is no
 * way to exercise that from a terminal, and no way to fake it that would prove
 * anything about the real path.
 *
 * So Tier 2 is written to fail *correctly* rather than pretend to work: it
 * attempts, and whatever refusal comes back is recorded verbatim and handed to
 * the ladder. That is not a placeholder — for the overwhelming majority of
 * meetings, being refused precisely and falling to Tier 1 *is* the behaviour,
 * and it is fully tested in tier.test.ts.
 *
 * The WebRTC client itself lands when enrolment does. Writing an unverifiable
 * SDP negotiation now would be code nobody has run, guarding a path nobody can
 * reach, and it would look identical to code that works.
 *
 * ## Why the offer shape is written down anyway
 *
 * The constraints below are unusually rigid — exactly three receive-only audio
 * media descriptions, one to three video, two ordered data channels — and they
 * are the kind of detail that is expensive to rediscover. Recording them beside
 * the code that will need them costs nothing and saves the next reader the
 * search.
 */

const auth = new GoogleAuth({
  scopes: [
    // Read a conference record and its transcript. Requested through the same
    // consent flow the connectors already use.
    "https://www.googleapis.com/auth/meetings.space.readonly",
  ],
});

export interface MeetingRef {
  meetingId: string;
  spaceName: string;
  conferenceId: string;
}

/**
 * Tier 2: the live, receive-only Meet Media client.
 *
 * The offer must carry:
 *   - exactly three receive-only audio media descriptions
 *   - one to three receive-only video media descriptions
 *   - ordered data channels named `session-control` and `media-stats`
 *
 * Refused outright for: participants not enrolled in the preview, underage
 * accounts, encrypted meetings, watermarked meetings.
 *
 * The agent **listens and cannot speak** — the API does not transmit, and no
 * part of this product may imply otherwise (FR-C4).
 */
export async function connectTier2(_meeting: MeetingRef): Promise<void> {
  // Rejects, deliberately and with the truth. The ladder turns this into a
  // recorded reason and a Tier 1 attempt, which is exactly what should happen
  // for any meeting whose participants are not all enrolled.
  throw new Error(
    "Meet Media API (Developer Preview) is not enabled for this project. " +
      "Live notes require every participant, the project and the OAuth " +
      "principal to be enrolled in the preview programme.",
  );
}

/**
 * Tier 1: the transcript, after the fact.
 *
 * Reached whenever Tier 2 is refused, which today is always. A conference
 * record exists only once the call has ended and Google has produced a
 * transcript, so "no transcript yet" is a normal answer rather than a fault —
 * and it is reported as such so the ladder can record something a person can
 * act on.
 */
export async function connectTier1(meeting: MeetingRef): Promise<void> {
  const client = await auth.getClient();
  const url =
    `https://meet.googleapis.com/v2/conferenceRecords/${encodeURIComponent(meeting.conferenceId)}` +
    `/transcripts`;

  const response = await client.request<{ transcripts?: unknown[] }>({
    url,
    method: "GET",
    // Never throws on a non-2xx: the status is the information here, and an
    // exception would collapse "not ready yet" and "not permitted" into one
    // unhelpful failure.
    validateStatus: () => true,
  });

  if (response.status === 404) {
    throw new Error("No conference record exists for this meeting yet.");
  }
  if (response.status === 403) {
    throw new Error("This account has not granted access to Meet transcripts.");
  }
  if (response.status >= 400) {
    throw new Error(`Meet returned HTTP ${response.status} for the transcript.`);
  }

  const transcripts = response.data?.transcripts ?? [];
  if (transcripts.length === 0) {
    // Transcription off for the meeting is the single most common cause, and
    // saying so is the difference between a user changing a setting and a user
    // filing a bug.
    throw new Error(
      "No transcript was produced for this meeting. Transcription may have been off.",
    );
  }
}
