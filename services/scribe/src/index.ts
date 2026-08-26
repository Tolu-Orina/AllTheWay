import express from "express";
import { initializeApp } from "firebase-admin/app";
import { z } from "zod";

import {
  appendNotes,
  closeMeeting,
  confirmCommitment,
  listCommitments,
  listMeetings,
  openMeeting,
} from "./meetings.js";
import { resolveTier, type Attempt } from "./tier.js";
import { connectTier1, connectTier2 } from "./meet.js";
import { mayJoin, setGlobal, setMeetingOptOut } from "./consent.js";
import { readMeetEvent, spaceIdFrom } from "./events.js";
import { rememberSpace, ownerOfSpace } from "./registry.js";
import { accessTokenFor } from "./credentials.js";
import { isClean } from "./screening.js";
import { subscribeToSpace, transcriptEntries } from "./meet.js";

/**
 * The scribe: one service owns meetings, whichever tier serves them.
 *
 * Internal-only, like every backend service here. It is called by the gateway,
 * which is the only thing holding a user session, and it calls the orchestrator
 * for planning. It never talks to a browser.
 *
 * ## Why the tiers are not two services
 *
 * A WebRTC client and a Workspace Events subscriber look like different
 * programs. They are two transports onto one meeting record, and the fallback
 * between them has to be a function call rather than a network hop — a ladder
 * that can fail *between its own rungs* is not a ladder.
 */

initializeApp();

const app = express();
app.use(express.json({ limit: "4mb" }));

// Both spellings. Google's frontend on *.run.app swallows the exact path
// `/healthz` and answers with its own 404, so the request never reaches this
// process; `/healthz/` gets through. Registering both means whoever writes the
// next probe cannot pick the wrong one.
for (const path of ["/healthz", "/healthz/"]) {
  app.get(path, (_req, res) => {
    res.json({ ok: true });
  });
}

/**
 * The uid arrives in a header from the gateway, never from a request body.
 *
 * The same rule as every other internal service: a caller that could name its
 * own user could name anyone's. This service is internal-only and reachable
 * solely by the gateway's identity, which is what makes the header trustworthy.
 */
function userOf(req: express.Request): string | null {
  const uid = req.header("X-User-Id")?.trim();
  return uid ? uid : null;
}

const StartSchema = z.object({
  meetingId: z.string().min(1).max(200),
  spaceName: z.string().min(1).max(200),
  conferenceId: z.string().min(1).max(200),
  participants: z.array(z.string().max(200)).max(500).default([]),
});

app.post("/meetings/start", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }

    const body = StartSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a meeting to join." });
      return;
    }

    // Consent first, upstream of the ladder (FR-C3).
    //
    // Attempting Tier 2 is itself visible: every participant sees a dialog when
    // the agent connects. So an opted-out meeting must produce no attempt at
    // all — a refusal that still showed the room a dialog would have already
    // done the thing the user opted out of.
    const consent = await mayJoin(uid, body.data.meetingId);
    if (!consent.allowed) {
      // Recorded, not silent. A meeting with no notes and no explanation is
      // indistinguishable from one where something broke.
      await openMeeting(uid, {
        ...body.data,
        outcome: { tier: 0, reason: consent.reason },
      });
      res.json({ tier: 0, reason: consent.reason });
      return;
    }

    // Tier 2 is attempted here, every time, per the standing direction. The
    // ladder is what stops that becoming "Tier nothing by default" on the many
    // meetings the preview refuses.
    const tier2: Attempt = { connect: () => connectTier2(body.data) };
    const tier1: Attempt = {
      // The credential is fetched inside the attempt, so "Google is not
      // connected" becomes a Tier 1 refusal the ladder records verbatim rather
      // than an exception that loses the Tier 2 reason alongside it.
      connect: async () => {
        const token = await accessTokenFor(uid);
        await connectTier1(body.data, token);
      },
    };
    const outcome = await resolveTier(tier2, tier1);

    await openMeeting(uid, { ...body.data, outcome });

    // Recorded at the only moment it is known: here, authenticated as this
    // user. A Workspace Events push later names a space and nothing else, and
    // without this there is no way back to a person.
    const spaceId = spaceIdFrom(body.data.spaceName);
    await rememberSpace(uid, spaceId, body.data.meetingId);

    // Ask Google to tell us when this call ends, so Tier 1 has a trigger rather
    // than a poll. Failing here does not fail the join: Tier 2 may already be
    // listening, and a meeting without a post-call transcript is still a
    // meeting. The reason is logged rather than surfaced mid-call — nobody
    // wants a subscription error while they are talking to a client.
    const topic = process.env.MEET_EVENTS_TOPIC ?? "";
    if (spaceId && topic) {
      try {
        await subscribeToSpace(spaceId, topic, await accessTokenFor(uid));
      } catch (error) {
        console.warn(
          JSON.stringify({
            message: "meet subscription failed",
            spaceId,
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }

    // 200 even when both tiers refused. The meeting is happening whatever we
    // managed to do about it, and a 5xx here would make the client retry a
    // join that is not going to start working.
    res.json({ tier: outcome.tier, reason: outcome.reason });
  })();
});

const NotesSchema = z.object({
  meetingId: z.string().min(1).max(200),
  utterances: z
    .array(
      z.object({
        at: z.string().max(40),
        speaker: z.string().max(200).optional(),
        text: z.string().max(10_000),
      }),
    )
    .max(500),
});

app.post("/meetings/notes", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }

    const body = NotesSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected utterances." });
      return;
    }

    // Mechanical only — regex over text, no model. Screening happens in the
    // orchestrator before anything reasons about this, exactly as the librarian
    // parses a PDF before screening it. A regex cannot be talked into anything.
    const notes = await appendNotes(uid, body.data.meetingId, body.data.utterances);
    res.json({ notes: notes.length });
  })();
});

app.post("/meetings/end", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }

    const id = z.string().min(1).max(200).safeParse(req.body?.meetingId);
    if (!id.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a meetingId." });
      return;
    }

    await closeMeeting(uid, id.data);
    res.status(204).end();
  })();
});

app.get("/meetings", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }
    res.json({ meetings: await listMeetings(uid) });
  })();
});

app.get("/meetings/:id/commitments", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }
    res.json({ commitments: await listCommitments(uid, req.params.id) });
  })();
});

app.post("/meetings/:id/commitments/confirm", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }

    const id = z.string().min(1).max(200).safeParse(req.body?.id);
    if (!id.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { id: string }." });
      return;
    }

    // Records approval. Does not act — carrying it out is a separate step
    // through the orchestrator and the autonomy floor.
    const found = await confirmCommitment(uid, req.params.id, id.data);
    if (!found) {
      res.status(404).json({ code: "not_found", message: "That commitment is not here." });
      return;
    }
    res.status(204).end();
  })();
});

app.post("/settings/meetings", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }

    const enabled = z.boolean().safeParse(req.body?.enabled);
    if (!enabled.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { enabled: boolean }." });
      return;
    }

    await setGlobal(uid, enabled.data);
    res.status(204).end();
  })();
});

app.post("/meetings/:id/opt-out", (req, res) => {
  void (async () => {
    const uid = userOf(req);
    if (!uid) {
      res.status(401).json({ code: "unauthenticated", message: "No user on this request." });
      return;
    }

    const optedOut = z.boolean().default(true).safeParse(req.body?.optedOut ?? true);
    if (!optedOut.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { optedOut: boolean }." });
      return;
    }

    await setMeetingOptOut(uid, req.params.id, optedOut.data);
    res.status(204).end();
  })();
});

/**
 * Workspace Events push: a conference ended, so Tier 1 has something to fetch.
 *
 * Unauthenticated in the sense that no user session exists here — the caller is
 * Pub/Sub, authenticated by IAM at the Cloud Run boundary. It carries no
 * meeting content and none is trusted from it: the event names a conference,
 * and the transcript is fetched separately with the user's own credential.
 *
 * **Always 204, except for something worth retrying.** Pub/Sub redelivers
 * anything unacknowledged, so returning an error for an event that will never
 * parse produces an infinite loop that is invisible until the bill arrives.
 */
app.post("/events/meet", (req, res) => {
  void (async () => {
    const event = readMeetEvent(req.body);
    if (!event) {
      // Understood well enough to reject. Acknowledged so it stops coming back.
      res.status(204).end();
      return;
    }

    if (!event.ended || !event.conferenceId) {
      // A real event we have no work for. Also acknowledged.
      res.status(204).end();
      return;
    }

    const owner = await ownerOfSpace(event.spaceId);
    if (!owner) {
      // Events arrive for spaces nobody connected, and for mappings that have
      // aged out. No amount of redelivery produces a user who was never
      // recorded, so this is acknowledged rather than retried.
      res.status(204).end();
      return;
    }

    try {
      const token = await accessTokenFor(owner.uid);
      const entries = await transcriptEntries(event.conferenceId, token);

      if (entries.length === 0) {
        await closeMeeting(owner.uid, owner.meetingId, "ready");
        res.status(204).end();
        return;
      }

      // Screened before anything reasons about it, and screened as one body
      // rather than line by line: an instruction split across two utterances is
      // invisible to a screener that only ever sees one of them.
      const clean = await isClean(entries.map((e) => e.text).join("\n"));
      if (!clean) {
        // Blocked, and the notes are not written. A refused transcript that
        // still produced notes would have defeated the point of refusing it.
        await closeMeeting(owner.uid, owner.meetingId, "blocked");
        res.status(204).end();
        return;
      }

      await appendNotes(owner.uid, owner.meetingId, entries);
      await closeMeeting(owner.uid, owner.meetingId, "ready");
      res.status(204).end();
    } catch (error) {
      // Worth retrying: a token exchange or a Meet call can fail transiently,
      // and Pub/Sub redelivery is the right answer for those. Distinguishing
      // this from the unparseable case above is what keeps one from becoming
      // an infinite loop and the other from being silently dropped.
      console.error(
        JSON.stringify({
          message: "meet transcript fetch failed",
          conferenceId: event.conferenceId,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
      res.status(500).end();
    }
  })();
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(JSON.stringify({ message: "scribe listening", port }));
});
