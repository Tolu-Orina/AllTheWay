import { z } from "zod";

/**
 * Google Workspace Events, which is how Tier 1 learns a meeting ended.
 *
 * ## Why a subscription rather than polling
 *
 * A transcript can only exist once the call is over. Polling for something
 * that happens twice a day is both wasteful and late — and "late" here means
 * the user asks about the meeting before the notes exist, which reads as the
 * feature not working.
 *
 * ## The envelope is untrusted, and it is not the transcript
 *
 * A push delivery says *that* something happened. It carries no meeting
 * content, and this module deliberately does not treat it as though it might:
 * the event names a conference record, and the transcript is then fetched from
 * Meet with the user's own credential. An event that could carry text would be
 * an unauthenticated way to put words into a user's meeting notes.
 *
 * ## A malformed event is dropped, not retried
 *
 * Pub/Sub retries anything that is not acknowledged, so returning an error for
 * an event that will never parse produces an infinite redelivery loop. The rule
 * is: acknowledge everything we understood well enough to reject, and only
 * retry what might succeed next time.
 */

/**
 * The push envelope. Pub/Sub wraps the payload in base64 inside `message`.
 */
export const PushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    messageId: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

/**
 * What a Workspace Events conference notification carries that we act on.
 *
 * Only the identifiers. Everything else in the payload is ignored rather than
 * stored — an event schema that grows should not silently start putting new
 * fields into a user's meeting record.
 */
export const MeetEventSchema = z.object({
  /** The event type, e.g. google.workspace.meet.conference.v2.ended */
  eventType: z.string().optional(),
  conferenceRecord: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
});

export interface MeetEvent {
  /** The conference record id, or "" when the event did not name one. */
  conferenceId: string;
  /**
   * The Meet space this happened in, from the CloudEvents `ce-subject`
   * attribute. This is the only field that leads back to a user — the payload
   * describes a conference, and a conference belongs to a space, and a space is
   * what someone connected.
   */
  spaceId: string;
  ended: boolean;
}

/**
 * `//meet.googleapis.com/spaces/abc` -> `abc`, and `spaces/abc` -> `abc`.
 *
 * Both forms appear depending on whether the id arrives as a CloudEvents source
 * or as a resource name. Normalising at the boundary means every lookup after
 * this point compares like with like — a mismatch here would present as
 * "nobody owns this meeting" rather than as a parsing bug.
 */
export function spaceIdFrom(value: string): string {
  if (!value) return "";
  const marker = "spaces/";
  const at = value.lastIndexOf(marker);
  return at === -1 ? value : value.slice(at + marker.length);
}

/**
 * Read a push body into the two facts we act on.
 *
 * Returns `null` for anything unusable, which the caller acknowledges rather
 * than retries. Distinguishing "cannot ever work" from "might work later" is
 * the whole job here: the first must be dropped or it loops forever.
 */
export function readMeetEvent(body: unknown): MeetEvent | null {
  const envelope = PushEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;

  const raw = envelope.data.message.data;
  if (!raw) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    // Not JSON. It will not become JSON on the fourth delivery.
    return null;
  }

  const event = MeetEventSchema.safeParse(decoded);
  if (!event.success) return null;

  const name = event.data.conferenceRecord?.name ?? "";
  // `conferenceRecords/abc123` -> `abc123`. Stored bare because that is what
  // the Meet REST paths take, and converting at the boundary means the rest of
  // the service never has to know the wire format.
  const conferenceId = name.startsWith("conferenceRecords/")
    ? name.slice("conferenceRecords/".length)
    : name;

  // The space arrives as a CloudEvents attribute rather than in the payload:
  // the subscription is on a space, and that is what the delivery is about.
  const attributes = envelope.data.message.attributes ?? {};
  const spaceId = spaceIdFrom(
    attributes["ce-subject"] ?? attributes["ce-source"] ?? attributes["space"] ?? "",
  );

  return {
    conferenceId,
    spaceId,
    // Only an ended conference can have a transcript. Other event types are
    // parsed successfully and then ignored, which is different from failing.
    ended: (event.data.eventType ?? "").endsWith("conference.v2.ended"),
  };
}
