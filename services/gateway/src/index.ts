import express from "express";
import { RevertPreferenceSchema, ToggleWatcherSchema } from "@alltheway/contracts";

import { env } from "./env.js";
import { requireUser } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { getSession, listSessions } from "./repos/sessions.js";
import { listPreferences, revertPreference } from "./repos/preferences.js";
import { listRuns, listWatchers, setWatcherRunning } from "./repos/watchers.js";
import { runTurn, streamTurn } from "./orchestrator.js";
import { createTokenMinter } from "./voice.js";
import { listRecent, record } from "./repos/ledger.js";
import { applyCors, openStream } from "./sse.js";
import { TOPICS, publish } from "./events.js";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "1mb" }));

/** Unauthenticated: Cloud Run needs this to consider the revision healthy. */
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Auth routes mount before the blanket requireUser: password reset is
// necessarily unauthenticated, and each route opts in individually.
// CORS preflight is answered before any authentication. A browser sends the
// preflight without credentials by definition, so requiring a user here would
// reject the very request that asks whether credentials may be sent.
app.options(/.*/, (req, res) => {
  applyCors(req, res);
  res.sendStatus(204);
});

app.use("/api/auth", authRoutes);

const api = express.Router();
api.use(requireUser);

/** Express 5 types params as `string | string[]`; routes here only ever take one. */
const param = (req: express.Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};

/** Wraps a handler so a thrown error becomes a typed ApiError, never a stack trace. */
const handle =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err: unknown) => {
      console.error(`[gateway] ${req.method} ${req.path}`, err);
      res.status(500).json({ code: "internal", message: "Something went wrong on our side." });
    });
  };

api.get(
  "/sessions",
  handle(async (req, res) => {
    res.json(await listSessions(req.uid!));
  }),
);

api.get(
  "/sessions/:id",
  handle(async (req, res) => {
    const session = await getSession(req.uid!, param(req, "id"));
    if (!session) {
      res.status(404).json({ code: "not_found", message: "That session is not here." });
      return;
    }
    res.json(session);
  }),
);

api.get(
  "/watchers",
  handle(async (req, res) => {
    res.json(await listWatchers(req.uid!));
  }),
);

api.get(
  "/watcher-runs",
  handle(async (req, res) => {
    res.json(await listRuns(req.uid!));
  }),
);

api.post(
  "/watchers/:id/running",
  handle(async (req, res) => {
    const body = ToggleWatcherSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { running: boolean }." });
      return;
    }
    const updated = await setWatcherRunning(req.uid!, param(req, "id"), body.data.running);
    if (!updated) {
      res.status(404).json({ code: "not_found", message: "That watcher is not here." });
      return;
    }
    res.json(updated);
  }),
);

/**
 * A short-lived credential for one voice session.
 *
 * POST rather than GET because it mints something: a GET that creates a
 * credential is cacheable, prefetchable, and shows up in logs as if it were
 * free. Behind `requireUser`, so a token is only ever issued to someone who
 * already proved who they are.
 */
api.post(
  "/voice/token",
  handle(async (req, res) => {
    const body = z.object({ sessionId: z.string().min(1).max(128) }).safeParse(req.body);
    if (!body.success) {
      res
        .status(400)
        .json({ code: "invalid_request", message: "Expected { sessionId: string }." });
      return;
    }

    try {
      res.json(await createTokenMinter().mint(body.data.sessionId, req.uid!));
    } catch (err) {
      // Voice being unavailable is a normal answer, not a server fault: the
      // rest of the product works without it, and the client shows a plain
      // "voice is not available" rather than a generic failure.
      console.warn(`[voice] token refused: ${(err as Error).message}`);
      res.status(503).json({
        code: "voice_unavailable",
        message: "Voice is not available right now. You can keep typing.",
      });
    }
  }),
);

/**
 * What the user confirmed, declined, or corrected (FR-V5).
 *
 * The client posts the decision it acted on rather than the gateway inferring
 * it: the browser is the only place that knows whether the person actually
 * pressed yes, and a ledger of what we assumed is worth nothing.
 */
api.post(
  "/sessions/:id/decision",
  handle(async (req, res) => {
    const body = z
      .object({
        kind: z.enum(["confirmed", "declined", "corrected"]),
        summary: z.string().min(1).max(2000),
        actions: z
          .array(z.object({ label: z.string(), action: z.string(), reason: z.string() }))
          .default([]),
        modality: z.enum(["voice", "text"]).default("text"),
        confidence: z.number().min(0).max(1).optional(),
      })
      .safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a decision." });
      return;
    }

    const id = await record(req.uid!, { sessionId: param(req, "id"), ...body.data });
    res.status(201).json({ id });
  }),
);

api.get(
  "/ledger",
  handle(async (req, res) => {
    res.json(await listRecent(req.uid!));
  }),
);

api.get(
  "/sessions/:id/turn/stream",
  handle(async (req, res) => {
    const message = typeof req.query.message === "string" ? req.query.message.trim() : "";
    if (!message || message.length > 4000) {
      res
        .status(400)
        .json({ code: "invalid_request", message: "Expected a message of 1-4000 characters." });
      return;
    }

    const prefs = await listPreferences(req.uid!);
    const stream = openStream(req, res);

    try {
      for await (const event of streamTurn({
        sessionId: param(req, "id"),
        userId: req.uid!,
        message,
        knownPreferences: prefs.map((p) => p.now),
      })) {
        // The reader left. Stop pulling from the agent rather than finishing a
        // turn nobody is waiting for.
        if (stream.closed()) break;
        stream.send(event);
      }
    } catch (err) {
      // The response is already a 200 with headers sent, so the failure has to
      // travel in-band. Throwing here would abort the connection with no
      // explanation the client could show.
      console.error(`[gateway] stream ${req.path}`, err);
      stream.send({ kind: "error", message: "Something went wrong on our side." });
    } finally {
      stream.end();
    }
  }),
);

api.post(
  "/sessions/:id/turn",
  handle(async (req, res) => {
    const body = z.object({ message: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { message: string }." });
      return;
    }

    // The profile is read here, not inside the orchestrator, so that service
    // stays stateless and can be tested without a database.
    const prefs = await listPreferences(req.uid!);

    const result = await runTurn({
      sessionId: param(req, "id"),
      userId: req.uid!,
      message: body.data.message,
      knownPreferences: prefs.map((p) => p.now),
    });

    res.json(result);
  }),
);

api.post(
  "/sessions/:id/end",
  handle(async (req, res) => {
    const id = param(req, "id");
    const session = await getSession(req.uid!, id);
    if (!session) {
      res.status(404).json({ code: "not_found", message: "That session is not here." });
      return;
    }

    // Publishing rather than synthesising inline: the profile update is not on
    // the user's critical path, and the consumer is idempotent so an at-least-
    // once redelivery costs nothing.
    const messageId = await publish(TOPICS.sessionEnded, { userId: req.uid, sessionId: id });
    res.json({ ok: true, messageId });
  }),
);

api.get(
  "/preferences",
  handle(async (req, res) => {
    res.json(await listPreferences(req.uid!));
  }),
);

api.post(
  "/preferences/revert",
  handle(async (req, res) => {
    const body = RevertPreferenceSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { id: string }." });
      return;
    }
    const ok = await revertPreference(req.uid!, body.data.id);
    if (!ok) {
      res.status(404).json({ code: "not_found", message: "That preference is not here." });
      return;
    }
    res.status(204).end();
  }),
);

app.use("/api", api);

app.listen(env.port, () => {
  console.log(`[gateway] listening on :${env.port}`);
  console.log(`[gateway] project=${env.projectId} emulator=${env.usingEmulator}`);
  if (env.webOrigins.length) {
    console.log(`[gateway] stream origins allowed: ${env.webOrigins.join(", ")}`);
  }
  if (env.allowAnonymous) {
    console.warn(
      `[gateway] ALLOW_ANONYMOUS is on — every request is treated as "${env.devUserId}". Development only.`,
    );
  }
});
