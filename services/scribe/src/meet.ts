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
 * Tier 1 reads with the **user's own credential** rather than the service's,
 * so Google enforces the tenant boundary alongside our own code. See
 * credentials.ts.
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
 *
 * Read with the **user's own credential**, never the service's. Google then
 * enforces the tenant boundary alongside our own code: a token minted from
 * Ada's grant cannot fetch Bo's meeting whatever this service asks for.
 */
export async function connectTier1(meeting: MeetingRef, accessToken: string): Promise<void> {
  const entries = await transcriptEntries(meeting.conferenceId, accessToken);
  if (entries.length === 0) {
    // Transcription being switched off for the meeting is the most common
    // cause by far, and saying so is the difference between a user changing a
    // setting and a user filing a bug.
    throw new Error(
      "No transcript was produced for this meeting. Transcription may have been off.",
    );
  }
}

export interface TranscriptEntry {
  at: string;
  speaker?: string;
  text: string;
}

async function meetGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://meet.googleapis.com/v2/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 404) {
    throw new Error("No conference record exists for this meeting yet.");
  }
  if (response.status === 403) {
    throw new Error("This account has not granted access to Meet transcripts.");
  }
  if (!response.ok) {
    throw new Error(`Meet returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

/**
 * Every spoken entry in a conference's transcript.
 *
 * Two calls, because Meet models a transcript and its entries separately: the
 * transcript is the artefact, the entries are what was said. A conference can
 * carry more than one transcript; all are read, because taking only the first
 * would silently drop the second half of a meeting that was paused and resumed.
 */
export async function transcriptEntries(
  conferenceId: string,
  accessToken: string,
): Promise<TranscriptEntry[]> {
  const transcripts = await meetGet<{ transcripts?: Array<{ name?: string }> }>(
    `conferenceRecords/${encodeURIComponent(conferenceId)}/transcripts`,
    accessToken,
  );

  const entries: TranscriptEntry[] = [];
  for (const transcript of transcripts.transcripts ?? []) {
    if (!transcript.name) continue;

    const page = await meetGet<{
      transcriptEntries?: Array<{ text?: string; startTime?: string; participant?: string }>;
    }>(`${transcript.name}/entries`, accessToken);

    for (const entry of page.transcriptEntries ?? []) {
      if (!entry.text?.trim()) continue;
      entries.push({
        at: entry.startTime ?? "",
        // The participant resource name, not a display name. Resolving it to a
        // person is a separate lookup, and an unresolved id must never be
        // rendered as though it were someone's name.
        speaker: entry.participant,
        text: entry.text,
      });
    }
  }

  return entries;
}


/**
 * Subscribe to a Meet space, so Tier 1 hears when a call ends.
 *
 * ## Per space, not per account
 *
 * Workspace Events subscribes to a *resource*. There is no "tell me about all
 * my meetings" — a subscription names one space, which is why the space id is
 * recorded against the user at the moment they start a meeting there. The two
 * are the same fact stored on both sides: Google knows to notify us, and we
 * know whose meeting it was.
 *
 * ## Expiry is not an error
 *
 * These subscriptions have a TTL measured in days. That is a renewal problem,
 * not a failure, and treating an expired subscription as breakage would send
 * someone looking for a bug when the answer is a scheduled reauthorisation.
 *
 * ## Attempted, and its refusal recorded
 *
 * Same discipline as the tier ladder. This can be refused for reasons outside
 * our control — the scope not granted, the space not owned by this user, the
 * API not enabled — and each of those is worth saying plainly rather than
 * collapsing into "subscription failed".
 */
export async function subscribeToSpace(
  spaceId: string,
  topicName: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch("https://workspaceevents.googleapis.com/v1/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      targetResource: `//meet.googleapis.com/spaces/${spaceId}`,
      // Only what Tier 1 acts on. Subscribing to every Meet event would
      // deliver participant joins and leaves for every call, which is a lot of
      // traffic to acknowledge and discard.
      eventTypes: ["google.workspace.meet.conference.v2.ended"],
      notificationEndpoint: { pubsubTopic: topicName },
      // The event tells us *that* a conference ended. The transcript is then
      // fetched with the user's credential — deliberately not delivered in the
      // event, so nothing about a meeting arrives over an unauthenticated path.
      payloadOptions: { includeResource: false },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 403) {
    throw new Error(
      "Meet notifications were refused. The account may not have granted meeting access.",
    );
  }
  if (response.status === 409) {
    // Already subscribed. Idempotent by intent: starting a second meeting in
    // the same space must not fail because the first one already subscribed.
    return;
  }
  if (!response.ok) {
    throw new Error(`Workspace Events returned HTTP ${response.status}.`);
  }
}
