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

    // Tier 2 is attempted here, every time, per the standing direction. The
    // ladder is what stops that becoming "Tier nothing by default" on the many
    // meetings the preview refuses.
    const tier2: Attempt = { connect: () => connectTier2(body.data) };
    const tier1: Attempt = { connect: () => connectTier1(body.data) };
    const outcome = await resolveTier(tier2, tier1);

    await openMeeting(uid, { ...body.data, outcome });

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

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(JSON.stringify({ message: "scribe listening", port }));
});
