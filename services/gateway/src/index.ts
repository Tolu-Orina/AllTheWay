import { createServer } from "node:http";
import express from "express";
import { RevertPreferenceSchema, ToggleWatcherSchema, CreateWatcherSchema } from "@alltheway/contracts";

import { env } from "./env.js";
import { requireUser } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { connectorRoutes } from "./routes/connectors.js";
import { registryRoutes } from "./routes/registry.js";
import { artifactRoutes } from "./routes/artifacts.js";
import { documentRoutes } from "./routes/documents.js";
import { meetingRoutes } from "./routes/meetings.js";
import { shareRoutes } from "./routes/shares.js";
import {
  ensureSession,
  getSession,
  listSessions,
  touchSession,
} from "./repos/sessions.js";
import { listPreferences, revertPreference } from "./repos/preferences.js";
import { listVisualPreferences, revertVisualPreference } from "./repos/visual.js";
import {
  createWatcher,
  listRuns,
  listWatchers,
  setWatcherRunning,
} from "./repos/watchers.js";
import { runTurn, streamTurn } from "./orchestrator.js";
import { listRecent, record } from "./repos/ledger.js";
import { readUsage } from "./repos/usage.js";
import { buildDigest } from "./repos/digest.js";
import { registerToken, removeToken } from "./repos/push.js";
import {
  forgetTranscript,
  keepsTranscripts,
  readTranscript,
  setKeepTranscripts,
} from "./repos/transcripts.js";
import { recordOffered, recordTaken } from "./repos/recoveries.js";
import {
  FailureKindSchema,
  LifeContextSchema,
  LocaleSchema,
  OnboardingJobSchema,
  type PlanStep,
} from "@alltheway/contracts";
import { getOnboarding, setOnboarding } from "./repos/onboarding.js";
import { retrieve } from "./repos/retrieval.js";
import { attachVoice } from "./voice/relay.js";
import { attachCapture } from "./meetings/capture.js";
import { openLiveTranscriber } from "./meetings/live-transcriber.js";
import { captureToScribe } from "./meetings/capture-sink.js";
import { runInsightPass } from "./meetings/insight-runner.js";
import { applyCors, openStream } from "./sse.js";
import { TOPICS, publish } from "./events.js";
import { userDoc } from "./firestore.js";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "1mb" }));

/** Unauthenticated: Cloud Run needs this to consider the revision healthy. */
// Both spellings, deliberately. Google's frontend on *.run.app swallows the
// exact path `/healthz` — it answers with its own 404 and the request never
// reaches this process, proven by its absence from the logs while /api/...
// from the same probe appears. `/healthz/` gets through. Registering both
// means whoever writes the next probe cannot pick the wrong one.
for (const path of ["/healthz", "/healthz/"]) {
  app.get(path, (_req, res) => res.json({ ok: true }));
}

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

// Also before the blanket requireUser: Google's OAuth callback arrives as a
// plain browser redirect with no Authorization header. The `state` parameter
// is what authenticates it, and the routes that *can* require a user do so
// individually.
app.use("/api/connectors", connectorRoutes);

// The Agent Registry, proxied. Authenticated per-route inside, like the
// connector routes, because the browser has no other way to reach it.
app.use("/api/registry", registryRoutes);

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

/**
 * Persist work from a turn. Lives here, not in the orchestrator: that service
 * is a planner and must stay stateless. A failed write is logged rather than
 * failing the turn — talking still happened.
 */
async function rememberWork(
  uid: string,
  sessionId: string,
  input: { utterance: string; plan?: PlanStep[]; companionNote?: string },
): Promise<void> {
  try {
    await touchSession(uid, sessionId, input);
  } catch (err) {
    console.error("[gateway] persist session", sessionId, err);
  }
}

// Where the user stands this month.
//
// Advisory: entitlement is decided in the connector gateway, beside the
// autonomy floor. This exists so someone can see a limit coming rather than
// discovering it by being refused.
api.get(
  "/usage",
  handle(async (req, res) => {
    res.json(await readUsage(req.uid!));
  }),
);

api.get(
  "/sessions",
  handle(async (req, res) => {
    res.json(await listSessions(req.uid!));
  }),
);

/**
 * Allocate a piece of work. Talking also creates a row — this exists so New
 * can land on a URL before the first message, not so a session becomes a
 * prerequisite for a conversation.
 */
api.post(
  "/sessions",
  handle(async (req, res) => {
    const id = crypto.randomUUID();
    await ensureSession(req.uid!, id, { title: "New work" });
    res.status(201).json({ id });
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

api.post(
  "/watchers",
  handle(async (req, res) => {
    const body = CreateWatcherSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        code: "invalid_request",
        message: "Expected a name, an instruction, and a trigger we recognise. Schedules cannot run more often than once an hour.",
      });
      return;
    }
    res.status(201).json(await createWatcher(req.uid!, body.data));
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

    // Preferences and passages are both context the orchestrator cannot fetch
    // for itself — it is stateless, and only this service can scope a request
    // to a user. Fetched together so a turn makes one round of reads.
    const [prefs, passages] = await Promise.all([
      listPreferences(req.uid!),
      retrieve(req.uid!, message),
    ]);
    const stream = openStream(req, res);
    const sessionId = param(req, "id");
    const steps: PlanStep[] = [];
    let note = "";

    try {
      // Materialise the parent before the planner answers, so a hang still
      // leaves a row titled from what they said.
      await rememberWork(req.uid!, sessionId, { utterance: message });

      for await (const event of streamTurn({
        sessionId,
        userId: req.uid!,
        message,
        knownPreferences: prefs.map((p) => p.now),
        passages,
      })) {
        if (event.kind === "step") steps.push(event.step);
        if (event.kind === "done") note = event.note;
        if (event.kind === "confirm") note = note || event.summary;
        if (event.kind === "clarify") note = note || event.question;
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
      await rememberWork(req.uid!, sessionId, {
        utterance: message,
        plan: steps.length > 0 ? steps : undefined,
        companionNote: note || undefined,
      });
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
    // Preferences and passages are both context the orchestrator cannot fetch
    // for itself — it is stateless, and only this service can scope a request
    // to a user. Fetched together so a turn makes one round of reads.
    const [prefs, passages] = await Promise.all([
      listPreferences(req.uid!),
      retrieve(req.uid!, body.data.message),
    ]);

    const sessionId = param(req, "id");
    await rememberWork(req.uid!, sessionId, { utterance: body.data.message });

    const result = await runTurn({
      sessionId,
      userId: req.uid!,
      message: body.data.message,
      knownPreferences: prefs.map((p) => p.now),
      passages,
    });

    const companionNote =
      result.note || result.confirm?.summary || result.clarify?.question || undefined;
    await rememberWork(req.uid!, sessionId, {
      utterance: body.data.message,
      plan: result.plan.length > 0 ? result.plan : undefined,
      companionNote,
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

// Brand memory. Served beside the learned preferences rather than under a
// separate feature: to a user they are one thing — "what it has decided about
// me" — and splitting them across two screens is how a preference becomes
// something nobody knows how to find, let alone undo.
// The morning digest. Built from the ledger and the runs on every request,
// never from a stored snapshot — see repos/digest.ts for why.
api.get(
  "/digest",
  handle(async (req, res) => {
    res.json(await buildDigest(req.uid!));
  }),
);

const PushTokenSchema = z.object({ token: z.string().min(1).max(1500) });

api.post(
  "/push/tokens",
  handle(async (req, res) => {
    const body = PushTokenSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { token: string }." });
      return;
    }
    const stored = await registerToken(req.uid!, body.data.token);
    if (!stored) {
      res.status(400).json({ code: "invalid_request", message: "That token cannot be stored." });
      return;
    }
    res.status(204).end();
  }),
);

api.post(
  "/push/tokens/remove",
  handle(async (req, res) => {
    const body = PushTokenSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { token: string }." });
      return;
    }
    await removeToken(req.uid!, body.data.token);
    res.status(204).end();
  }),
);

const OfferedSchema = z.object({
  turnId: z.string().min(1).max(200),
  failureKind: FailureKindSchema,
});

api.post(
  "/recoveries",
  handle(async (req, res) => {
    const body = OfferedSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a turnId and a failureKind." });
      return;
    }
    const id = await recordOffered(req.uid!, body.data.turnId, body.data.failureKind);
    res.status(201).json({ id });
  }),
);

const TakenSchema = z.object({
  id: z.string().min(1).max(200),
  routeId: z.string().min(1).max(100),
});

api.post(
  "/recoveries/taken",
  handle(async (req, res) => {
    const body = TakenSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected an id and a routeId." });
      return;
    }
    const ok = await recordTaken(req.uid!, body.data.id, body.data.routeId);
    if (!ok) {
      res.status(404).json({ code: "not_found", message: "That recovery is not there." });
      return;
    }
    res.status(204).end();
  }),
);

// Voice transcripts. Off unless switched on — see repos/transcripts.ts for why
// this is a decision rather than a default.
api.get(
  "/settings/voice",
  handle(async (req, res) => {
    res.json({ keepTranscripts: await keepsTranscripts(req.uid!) });
  }),
);

api.post(
  "/settings/voice",
  handle(async (req, res) => {
    const keep = z.boolean().safeParse(req.body?.keepTranscripts);
    if (!keep.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { keepTranscripts: boolean }." });
      return;
    }
    await setKeepTranscripts(req.uid!, keep.data);
    res.status(204).end();
  }),
);

api.get(
  "/sessions/:id/transcript",
  handle(async (req, res) => {
    res.json(await readTranscript(req.uid!, String(req.params.id)));
  }),
);

api.delete(
  "/sessions/:id/transcript",
  handle(async (req, res) => {
    // Switching recording off stops new lines; it does not remove what is
    // already there, and that is the next thing anyone asks.
    const removed = await forgetTranscript(req.uid!, String(req.params.id));
    res.json({ removed });
  }),
);

// Interface language. Stored against the person rather than the browser: a
// choice made on a laptop is about them, not about that device, and
// rediscovering it per device is how a setting feels broken.
api.get(
  "/settings/locale",
  handle(async (req, res) => {
    const doc = await userDoc(req.uid!).collection("settings").doc("locale").get();
    res.json({ locale: doc.exists ? (doc.get("locale") ?? null) : null });
  }),
);

api.post(
  "/settings/locale",
  handle(async (req, res) => {
    const locale = LocaleSchema.safeParse(req.body?.locale);
    if (!locale.success) {
      // A locale we do not have would render an interface nobody can read, so
      // it is refused rather than stored and discovered at load.
      res.status(400).json({ code: "invalid_request", message: "Not a supported language." });
      return;
    }
    await userDoc(req.uid!)
      .collection("settings")
      .doc("locale")
      .set({ locale: locale.data }, { merge: true });
    res.status(204).end();
  }),
);

// First-run job. Absent is a real state — show the job screen — so this never
// 404s. A blip that looked like a first visit would trap them on it forever.
api.get(
  "/settings/onboarding",
  handle(async (req, res) => {
    res.json(await getOnboarding(req.uid!));
  }),
);

api.post(
  "/settings/onboarding",
  handle(async (req, res) => {
    const body = z
      .object({
        job: OnboardingJobSchema,
        lifeContext: LifeContextSchema.nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a job we recognise." });
      return;
    }
    res.json(await setOnboarding(req.uid!, body.data));
  }),
);

api.use(meetingRoutes);
api.use(shareRoutes);

api.get(
  "/visual-preferences",
  handle(async (req, res) => {
    res.json(await listVisualPreferences(req.uid!));
  }),
);

api.post(
  "/visual-preferences/revert",
  handle(async (req, res) => {
    const body = RevertPreferenceSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { id: string }." });
      return;
    }
    const ok = await revertVisualPreference(req.uid!, body.data.id);
    if (!ok) {
      res.status(404).json({ code: "not_found", message: "That preference is not here." });
      return;
    }
    res.status(204).end();
  }),
);

// Artifacts. On the authenticated router rather than beside the connector
// callback, because every route here requires a verified user — there is no
// browser-redirect case to accommodate.
api.use("/artifacts", artifactRoutes);

// Documents, proxied to the librarian with a signed scope token.
api.use("/documents", documentRoutes);

app.use("/api", api);

const server = createServer(app);
attachVoice(server);

// Tier 1.5: the meeting the user is already in, captured by the extension on
// their own machine. Shares the server's upgrade handling with voice through
// the router — see ws-router.ts for why that had to be shared rather than
// stacked.
attachCapture(server, {
  openTranscriber: openLiveTranscriber,
  // Screened, metered, and cited — see insight-runner.ts. Passing it here
  // rather than importing it inside capture.ts keeps the capture relay
  // testable without a model behind it.
  runInsights: runInsightPass,
  ...(() => {
    const sink = captureToScribe();
    return { ...sink, onInsights: sink.storeInsights };
  })(),
});

server.listen(env.port, () => {
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
