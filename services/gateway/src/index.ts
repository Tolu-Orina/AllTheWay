import { createServer } from "node:http";
import express from "express";
import {
  RevertPreferenceSchema,
  AcceptPreferenceSchema,
  SetHatSchema,
  ConceptEventSchema,
  RevertConceptSchema,
  ToggleWatcherSchema,
  CreateWatcherSchema,
} from "@alltheway/contracts";

import { env } from "./env.js";
import { requireUser } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { connectorRoutes } from "./routes/connectors.js";
import { registryRoutes } from "./routes/registry.js";
import { artifactRoutes } from "./routes/artifacts.js";
import { documentRoutes } from "./routes/documents.js";
import { meetingRoutes } from "./routes/meetings.js";
import { shareRoutes } from "./routes/shares.js";
import { studioRoutes } from "./routes/studio.js";
import { lifeRoutes } from "./routes/life.js";
import { carryOutConfirmedPlan, declinePendingPlan } from "./confirm-act.js";
import {
  ensureSession,
  getSession,
  listSessions,
  touchSession,
  appendThread,
  setCorrection,
  correctionFields,
  patchPlanArguments,
  overlayConfirmOnPlan,
  VOICE_TITLE,
} from "./repos/sessions.js";
import { composeFollowUpTurn } from "./compose-followup.js";
import { listPreferences, revertPreference, acceptPreference } from "./repos/preferences.js";
import { listVisualPreferences, revertVisualPreference } from "./repos/visual.js";
import { listConcepts, recordConcept, revertConcept } from "./repos/concepts.js";
import { getActiveHat, setActiveHat } from "./repos/hat.js";
import {
  createWatcher,
  listRuns,
  listWatchers,
  setWatcherRunning,
} from "./repos/watchers.js";
import { runTurn, streamTurn } from "./orchestrator.js";
import { loadTurnContext } from "./turn-context.js";
import { listRecent, record } from "./repos/ledger.js";
import { readUsage } from "./repos/usage.js";
import { buildDigest } from "./repos/digest.js";
import { buildHome } from "./repos/home.js";
import { buildDay } from "./calendar-day.js";
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
  type ThreadMessage,
} from "@alltheway/contracts";
import { getOnboarding, setOnboarding } from "./repos/onboarding.js";
import { clockWire, isIanaTimeZone } from "./clock.js";
import { getClock, rememberDeviceTimeZone, setClock } from "./repos/clock.js";
import { attachVoice } from "./voice/relay.js";
import { attachCapture } from "./meetings/capture.js";
import { openLiveTranscriber } from "./meetings/live-transcriber.js";
import { captureToScribe } from "./meetings/capture-sink.js";
import { runInsightPass } from "./meetings/insight-runner.js";
import { applyCors, openStream } from "./sse.js";
import { TOPICS, publish } from "./events.js";
import { userDoc } from "./firestore.js";
import { z } from "zod";
import { billingOrigin, processWebhook, startCheckout, startPortal } from "./billing.js";

const app = express();

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");
    void processWebhook(raw, req.header("stripe-signature")).then(({ status, body }) => {
      res.status(status).json(body);
    });
  },
);

/**
 * Documents travel as base64 in JSON, same as every other write. A 25MB
 * ceiling on the *decoded* file is ~33MB on the wire; Cloud Run itself stops
 * at 32MB, so this matches that envelope. Every other route stays at 1MB —
 * a 32MB JSON body on a turn or a preference write is not a document, it is
 * a problem. The old global 1MB default 413'd a phone photo and the client
 * had no JSON body to read, so it said "Something went wrong."
 */
app.use((req, res, next) => {
  const limit = req.path.startsWith("/api/documents") ? "32mb" : "1mb";
  express.json({ limit })(req, res, next);
});

/** Reflect CORS on every response so studio generate (POST, gateway host) is readable. */
app.use((req, res, next) => {
  applyCors(req, res);
  next();
});

app.use(
  (
    err: { type?: string; status?: number },
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err?.type === "entity.too.large" || err?.status === 413) {
      applyCors(req, res);
      return res.status(413).json({
        code: "too_large",
        message: "That file is too large.",
      });
    }
    next(err);
  },
);

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

async function rememberThread(uid: string, sessionId: string, entries: ThreadMessage[]): Promise<void> {
  try {
    await appendThread(uid, sessionId, entries);
  } catch (err) {
    console.error("[gateway] persist thread", sessionId, err);
  }
}

const isoNow = () => new Date().toISOString();

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

api.post(
  "/billing/checkout",
  handle(async (req, res) => {
    const raw = z.object({ plan: z.string().optional() }).safeParse(req.body ?? {});
    const plan = (raw.success ? raw.data.plan : undefined)?.trim().toLowerCase() || "plus";
    if (plan === "team" || plan === "enterprise") {
      res.status(400).json({
        code: "not_self_serve",
        message: "Team is not self-serve. Talk to us.",
      });
      return;
    }
    if (plan !== "plus" && plan !== "max") {
      res.status(400).json({ code: "invalid_request", message: "Choose Plus or Max." });
      return;
    }
    const result = await startCheckout(req.uid!, billingOrigin(req), plan);
    if ("url" in result) {
      res.json({ url: result.url });
      return;
    }
    const code = result.status === 404 ? "not_found" : "not_configured";
    res.status(result.status).json({ code, message: result.error });
  }),
);

api.post(
  "/billing/portal",
  handle(async (req, res) => {
    const result = await startPortal(req.uid!, billingOrigin(req));
    if ("url" in result) {
      res.json({ url: result.url });
      return;
    }
    const code = result.status === 404 ? "not_found" : "not_configured";
    res.status(result.status).json({ code, message: result.error });
  }),
);

api.get(
  "/sessions",
  handle(async (req, res) => {
    const raw = typeof req.query.surface === "string" ? req.query.surface : "";
    const surface = raw === "companion" || raw === "voice" ? raw : "work";
    res.json(await listSessions(req.uid!, surface));
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
    const body = z
      .object({ surface: z.enum(["work", "companion", "voice"]).optional() })
      .safeParse(req.body ?? {});
    const surface =
      body.success && (body.data.surface === "companion" || body.data.surface === "voice")
        ? body.data.surface
        : "work";
    const id = crypto.randomUUID();
    await ensureSession(req.uid!, id, {
      title: surface === "companion" ? "New chat" : surface === "voice" ? VOICE_TITLE : "New work",
      surface,
    });
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

/**
 * Field edits on a pending compose. Arguments only; connector and tool must
 * already match the stored step so the browser cannot turn a draft into a send.
 */
api.patch(
  "/sessions/:id/plan-args",
  handle(async (req, res) => {
    const body = z
      .object({
        patches: z
          .array(
            z.object({
              connector: z.string().min(1).max(80),
              tool: z.string().min(1).max(80),
              arguments: z.record(z.string(), z.unknown()),
            }),
          )
          .min(1)
          .max(8),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected plan argument edits." });
      return;
    }
    const result = await patchPlanArguments(req.uid!, param(req, "id"), body.data.patches);
    if (result === "missing") {
      res.status(404).json({ code: "not_found", message: "That session is not here." });
      return;
    }
    if (result === "mismatch") {
      res.status(409).json({
        code: "plan_mismatch",
        message: "Those fields do not match the stored plan.",
      });
      return;
    }
    res.json({ ok: true });
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
 * Effects replay the stored plan, never the request body. Voice can also
 * confirm through they_said_yes; claiming the plan first is what stops two
 * yeses from creating the same meeting twice.
 */
api.post(
  "/sessions/:id/decision",
  handle(async (req, res) => {
    const body = z
      .object({
        kind: z.enum(["confirmed", "declined", "corrected"]),
        summary: z.string().min(1).max(2000),
        now: z.string().max(2000).optional(),
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

    const sessionId = param(req, "id");

    if (body.data.kind === "corrected") {
      // Written before the ledger so a learning signal cannot exist without
      // the fact it learned from. Publishing session-ended here (not only
      // on leave) is what lets the next turn in this same session see it.
      const parsed = correctionFields(body.data.summary, body.data.now);
      if (!parsed.ok) {
        res.status(400).json({
          code: "invalid_request",
          message:
            parsed.reason === "missing_now"
              ? "A correction needs what it should have been."
              : "That correction does not change anything.",
        });
        return;
      }
      const hat = await getActiveHat(req.uid!);
      const written = await setCorrection(req.uid!, sessionId, { ...parsed, hat });
      if (written === "missing") {
        res.status(404).json({ code: "not_found", message: "That session is not here." });
        return;
      }
      const id = await record(req.uid!, {
        sessionId,
        kind: "corrected",
        summary: parsed.was,
        now: parsed.now,
        actions: body.data.actions,
        modality: body.data.modality,
        confidence: body.data.confidence,
      });
      await publish(TOPICS.sessionEnded, { userId: req.uid, sessionId });
      res.status(201).json({ id, did: [] });
      return;
    }

    if (body.data.kind === "confirmed") {
      // From the stored plan, never the request body: the browser must not
      // be able to name an action nobody was shown. Voice may also confirm
      // the same plan via they_said_yes; claiming first prevents two meetings.
      const result = await carryOutConfirmedPlan({
        uid: req.uid!,
        sessionId,
        summary: body.data.summary,
        modality: body.data.modality,
        actions: body.data.actions,
      });
      res.status(201).json({ id: result.id, did: result.did });
      return;
    }

    if (body.data.kind === "declined") {
      const result = await declinePendingPlan({
        uid: req.uid!,
        sessionId,
        summary: body.data.summary,
        modality: body.data.modality,
        actions: body.data.actions,
      });
      res.status(201).json({ id: result.id, did: result.did });
      return;
    }

    const id = await record(req.uid!, { sessionId, ...body.data });
    res.status(201).json({ id, did: [] });
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
    const sessionId = param(req, "id");
    const follow = composeFollowUpTurn((await getSession(req.uid!, sessionId))?.plan ?? [], message);
    const stream = openStream(req, res);
    const steps: PlanStep[] = [];
    let note = "";
    let phase: ThreadMessage["phase"] = "done";
    let options: string[] | undefined;
    let actions: ThreadMessage["actions"];
    let citations: ThreadMessage["citations"];

    try {
      if (follow) {
        await rememberWork(req.uid!, sessionId, { utterance: message });
        await rememberThread(req.uid!, sessionId, [
          { role: "user", text: message, at: isoNow() },
        ]);
        for (const step of follow.plan) {
          steps.push(step);
          if (stream.closed()) break;
          stream.send({ kind: "step", step });
        }
        note = follow.confirm.summary;
        options = follow.confirm.options;
        actions = follow.confirm.actions;
        phase = "confirm";
        if (!stream.closed()) {
          stream.send({
            kind: "confirm",
            summary: follow.confirm.summary,
            options: follow.confirm.options,
            actions: follow.confirm.actions,
          });
        }
      } else {
        const context = await loadTurnContext(req.uid!, sessionId, message);
        await rememberWork(req.uid!, sessionId, { utterance: message });
        await rememberThread(req.uid!, sessionId, [
          { role: "user", text: message, at: isoNow() },
        ]);
        for await (const event of streamTurn(context)) {
          if (event.kind === "step") steps.push(event.step);
          if (event.kind === "done" && phase !== "confirm" && phase !== "clarify") {
            note = event.note;
            citations = event.citations;
            phase = "done";
          }
          if (event.kind === "confirm") {
            note = note || event.summary;
            options = event.options;
            actions = event.actions;
            phase = "confirm";
          }
          if (event.kind === "clarify") {
            note = note || event.question;
            options = event.options;
            phase = "clarify";
          }
          if (event.kind === "error") {
            note = event.message;
            phase = "error";
          }
          if (stream.closed()) break;
          stream.send(event);
        }
      }
    } catch (err) {
      // The response is already a 200 with headers sent, so the failure has to
      // travel in-band. Throwing here would abort the connection with no
      // explanation the client could show.
      console.error(`[gateway] stream ${req.path}`, err);
      stream.send({ kind: "error", message: "Something went wrong on our side." });
      note = note || "Something went wrong on our side.";
      phase = "error";
    } finally {
      // An aborted stream is a reader that left. Persisting its partial plan
      // would overwrite the retry that actually finished.
      if (!stream.closed()) {
        const stored = overlayConfirmOnPlan(steps, actions ?? []);
        await rememberWork(req.uid!, sessionId, {
          utterance: message,
          plan: stored.length > 0 ? stored : undefined,
          companionNote: note || undefined,
        });
        if (note) {
          await rememberThread(req.uid!, sessionId, [
            {
              role: "agent",
              text: note,
              at: isoNow(),
              phase,
              options,
              actions,
              citations,
              steps: stored.length ? stored : undefined,
            },
          ]);
        }
      }
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
    const sessionId = param(req, "id");
    const follow = composeFollowUpTurn(
      (await getSession(req.uid!, sessionId))?.plan ?? [],
      body.data.message,
    );

    if (follow) {
      await rememberWork(req.uid!, sessionId, {
        utterance: body.data.message,
        plan: follow.plan,
        companionNote: follow.confirm.summary,
      });
      await rememberThread(req.uid!, sessionId, [
        { role: "user", text: body.data.message, at: isoNow() },
        {
          role: "agent",
          text: follow.confirm.summary,
          at: isoNow(),
          phase: "confirm",
          options: follow.confirm.options,
          actions: follow.confirm.actions,
          steps: follow.plan,
        },
      ]);
      res.json({
        decision: "confirm",
        confirm: follow.confirm,
        plan: follow.plan,
        note: follow.confirm.summary,
        trace: [],
        citations: [],
      });
      return;
    }

    const context = await loadTurnContext(req.uid!, sessionId, body.data.message);

    await rememberWork(req.uid!, sessionId, { utterance: body.data.message });
    await rememberThread(req.uid!, sessionId, [
      { role: "user", text: body.data.message, at: isoNow() },
    ]);

    const result = await runTurn(context);

    const companionNote =
      result.note || result.confirm?.summary || result.clarify?.question || undefined;
    const stored = overlayConfirmOnPlan(result.plan, result.confirm?.actions ?? []);
    await rememberWork(req.uid!, sessionId, {
      utterance: body.data.message,
      plan: stored.length > 0 ? stored : undefined,
      companionNote,
    });
    if (companionNote) {
      const phase =
        result.decision === "clarify"
          ? "clarify"
          : result.decision === "confirm"
            ? "confirm"
            : "done";
      await rememberThread(req.uid!, sessionId, [
        {
          role: "agent",
          text: companionNote,
          at: isoNow(),
          phase,
          options: result.clarify?.options ?? result.confirm?.options,
          actions: result.confirm?.actions,
          citations: result.citations,
          steps: stored.length ? stored : undefined,
        },
      ]);
    }

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

api.post(
  "/preferences/accept",
  handle(async (req, res) => {
    const body = AcceptPreferenceSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { id: string }." });
      return;
    }
    const ok = await acceptPreference(req.uid!, body.data.id);
    if (!ok) {
      res.status(404).json({ code: "not_found", message: "That preference is not here." });
      return;
    }
    res.status(204).end();
  }),
);

api.get(
  "/concepts",
  handle(async (req, res) => {
    res.json(await listConcepts(req.uid!));
  }),
);

api.post(
  "/concepts/reask",
  handle(async (req, res) => {
    const body = ConceptEventSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a document and a label." });
      return;
    }
    const row = await recordConcept(req.uid!, { ...body.data, kind: "reask" });
    res.status(201).json(row);
  }),
);

api.post(
  "/concepts/miss",
  handle(async (req, res) => {
    const body = ConceptEventSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a document and a label." });
      return;
    }
    const row = await recordConcept(req.uid!, { ...body.data, kind: "miss" });
    res.status(201).json(row);
  }),
);

api.post(
  "/concepts/hit",
  handle(async (req, res) => {
    const body = ConceptEventSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a document and a label." });
      return;
    }
    const row = await recordConcept(req.uid!, { ...body.data, kind: "hit" });
    res.json(row);
  }),
);

api.post(
  "/concepts/revert",
  handle(async (req, res) => {
    const body = RevertConceptSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { id: string }." });
      return;
    }
    const ok = await revertConcept(req.uid!, body.data.id);
    if (!ok) {
      res.status(404).json({ code: "not_found", message: "That concept is not here." });
      return;
    }
    res.status(204).end();
  }),
);

api.post(
  "/hat",
  handle(async (req, res) => {
    const body = SetHatSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a hat, or null for all." });
      return;
    }
    res.json({ hat: await setActiveHat(req.uid!, body.data.hat) });
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

api.get(
  "/home",
  handle(async (req, res) => {
    res.json(await buildHome(req.uid!));
  }),
);

api.get(
  "/home/day",
  handle(async (req, res) => {
    res.json(await buildDay(req.uid!));
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

// IANA clock. Device ping, calendar zone, or an override they set. Never GPS.
api.get(
  "/settings/clock",
  handle(async (req, res) => {
    res.json(clockWire(await getClock(req.uid!)));
  }),
);

api.post(
  "/settings/clock",
  handle(async (req, res) => {
    const body = z
      .object({
        timeZone: z.string(),
        source: z.enum(["device", "override", "ping"]),
      })
      .safeParse(req.body);
    if (!body.success || !isIanaTimeZone(body.data.timeZone)) {
      res.status(400).json({ code: "invalid_request", message: "Not a recognised time zone." });
      return;
    }
    if (body.data.source === "ping") {
      await rememberDeviceTimeZone(req.uid!, body.data.timeZone);
      res.json(clockWire(await getClock(req.uid!)));
      return;
    }
    try {
      res.json(
        clockWire(
          await setClock(req.uid!, {
            timeZone: body.data.timeZone,
            source: body.data.source,
          }),
        ),
      );
    } catch {
      res.status(400).json({ code: "invalid_request", message: "Not a recognised time zone." });
    }
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

// Studio Generate. Confirmed at the button, not via a stored plan — the
// browser must not be able to name an arbitrary connector tool this way, so
// the route only ever calls the media image and draft-video tools.
api.use("/studio", studioRoutes);

// Documents, proxied to the librarian with a signed scope token.
api.use("/documents", documentRoutes);

// Life: people, places, rhythms, reminders, proposed commitments.
api.use("/life", lifeRoutes);

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
