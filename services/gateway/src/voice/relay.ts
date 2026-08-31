import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { uidFromToken } from "../auth.js";
import { env } from "../env.js";
import { routeUpgrade } from "../ws-router.js";
import { runTurn } from "../orchestrator.js";
import { loadTurnContext } from "../turn-context.js";
import { READ_TOOL_NAMES, runReadTool, THEY_SAID_NO, THEY_SAID_YES } from "./tools.js";
import {
  END_THIS_CONVERSATION,
  HANGUP_TOOL_RESULT,
  SpokenHangup,
  hangupDelays,
} from "./hangup.js";
import { readUsage, recordUsage } from "../repos/usage.js";
import { recordLine } from "../repos/transcripts.js";
import { appendThread, ensureSession, getSession, overlayConfirmOnPlan, touchSession, VOICE_TITLE } from "../repos/sessions.js";
import { composeFollowUpTurn, composeNeedsAddress } from "../compose-followup.js";
import { createLiveOpener, type LiveOpener } from "./backend.js";
import {
  AUTH_TIMEOUT_MS,
  INPUT_HZ,
  OUTPUT_HZ,
  TranscriptAccumulator,
  VOICE_PATH,
  isAuthMessage,
  isPcmMessage,
  type RelayMessage,
} from "./protocol.js";
import { isSpokenNo, isSpokenYes } from "./confirm.js";
import { carryOutConfirmedPlan, declinePendingPlan, speakActOutcomes } from "../confirm-act.js";

function originAllowed(origin: string | undefined): boolean {
  // Empty WEB_ORIGINS is development: Vite proxies and the request is
  // same-origin, or the Origin header is the Vite origin talking to :8080.
  if (env.webOrigins.length === 0) return true;
  return typeof origin === "string" && env.webOrigins.includes(origin);
}

/**
 * Store one line, if this user keeps transcripts.
 *
 * Failure is swallowed on purpose. Voice was ephemeral before this existed, so
 * a conversation that cannot be recorded should still be a conversation —
 * dropping the call because a write failed would make the optional feature the
 * fragile one.
 */
async function keep(
  uid: string,
  sessionId: string,
  side: "user" | "model",
  text: string,
): Promise<void> {
  try {
    await recordLine(uid, sessionId, { side, text, at: new Date().toISOString() });
  } catch {
    // Deliberately silent. See above.
  }
}

function send(ws: WebSocket, message: RelayMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function parseJson(data: unknown): unknown {
  try {
    return JSON.parse(String(data));
  } catch {
    return undefined;
  }
}

async function firstMessage(ws: WebSocket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("auth-timeout"));
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(parseJson(data));
    };
    ws.once("message", onMessage);
    ws.once("close", () => {
      clearTimeout(timer);
      reject(new Error("closed"));
    });
  });
}

/**
 * Attach the voice relay to the HTTP server Express is already using.
 *
 * Upgrade happens here rather than inside Express because Express 5 still
 * treats a WebSocket as a request it cannot finish. The path is the only
 * coupling: everything else under `/api` stays HTTP.
 */
export function attachVoice(server: Server, opener: LiveOpener = createLiveOpener()): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Path matching moved to the shared router. This listener used to destroy
  // any socket whose path it did not recognise, which would have torn down
  // the meeting-capture endpoint before its own handler ever ran.
  routeUpgrade(server, VOICE_PATH, (req: IncomingMessage, socket, head) => {
    if (!originAllowed(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    void handleConnection(ws, opener);
  });

  return wss;
}

async function handleConnection(ws: WebSocket, opener: LiveOpener): Promise<void> {
  let raw: unknown;
  try {
    raw = await firstMessage(ws, AUTH_TIMEOUT_MS);
  } catch (err) {
    const reason = (err as Error).message === "auth-timeout" ? "auth_timeout" : "closed";
    send(ws, {
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
      },
    });
    ws.close(4001, reason);
    return;
  }

  if (!isAuthMessage(raw)) {
    send(ws, {
      error: { code: "unauthenticated", message: "Sign in to continue." },
    });
    ws.close(4001, "bad_auth");
    return;
  }

  const uid = await uidFromToken(raw.auth.token || undefined);
  if (!uid) {
    send(ws, {
      error: { code: "unauthenticated", message: "Sign in to continue." },
    });
    ws.close(4001, "unauthenticated");
    return;
  }

  // Metering is a display copy, not the authority. A stuck usage read must
  // not hold the socket — that is the hang that looks like voice never starts.
  let usage: Awaited<ReturnType<typeof readUsage>> | undefined;
  try {
    usage = await Promise.race([
      readUsage(uid),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("usage-timeout")), 800);
      }),
    ]);
  } catch (err) {
    console.warn("[voice] usage check skipped", (err as Error).message);
  }
  const voice = usage?.meters.find((meter) => meter.meter === "voice_minutes");
  if (voice && voice.limit !== null && voice.remaining === 0) {
    const message =
      usage?.tier === "free"
        ? "You've used this month's voice minutes. Upgrade to Plus for 600 minutes, or keep typing."
        : "You've used this month's voice minutes. You can keep typing.";
    send(ws, { error: { code: "plan_limit", message } });
    ws.close(4008, "plan_limit");
    return;
  }

  const sessionId = raw.auth.sessionId.slice(0, 128);
  const cancelled = new Set<string>();
  const slot: {
    live?: {
      sendPcm: (b: string) => void;
      sendToolResult: (id: string, name: string, payload: unknown) => void;
      close: () => void;
    };
  } = {};
  const spokenHangup = new SpokenHangup(() => {
    slot.live?.close();
  }, hangupDelays);

  // Parent document first, so a conversation that only lives in a transcript
  // subcollection is not invisible to listSessions. Not awaited: a slow write
  // must not hold the socket before the person can talk — that is the hang
  // that looks like "voice never starts".
  void ensureSession(uid, sessionId, { title: VOICE_TITLE }).catch((err) =>
    console.error("[voice] persist session", sessionId, err),
  );

  let titled = false;
  const captions = new TranscriptAccumulator();

  const emitTranscript = (side: "user" | "model", text: string, finished: boolean) => {
    const line = captions.push(side, text, finished);
    send(ws, { transcript: { side, text: line.text, finished: line.finished } });
    // Only the committed utterance. Folding happens first so a stream of
    // deltas ("I'll" + " send") is stored as one sentence, not the last chunk.
    //
    // Never awaited: a slow write must not delay the caption a person is
    // reading while they speak.
    if (!line.finished || !line.text.trim()) return;
    const persistText = line.text;
    const persistSide = side;
    const retitle = persistSide === "user" && !titled;
    if (retitle) titled = true;
    queueMicrotask(() => {
      void keep(uid, sessionId, persistSide, persistText);
      void appendThread(uid, sessionId, [
        {
          role: persistSide === "user" ? "user" : "agent",
          text: persistText,
          at: new Date().toISOString(),
        },
      ]).catch((err) => console.error("[voice] persist caption", sessionId, err));
      if (retitle) {
        void touchSession(uid, sessionId, { utterance: persistText }).catch((err) =>
          console.error("[voice] retitle session", sessionId, err),
        );
      }
    });
  };

  const commitOpen = (side?: "user" | "model") => {
    for (const line of captions.flush(side)) {
      emitTranscript(line.side, line.text, true);
    }
  };

  try {
    slot.live = await opener({
      resumeHandle: raw.auth.resumeHandle,
      events: {
        onReady() {
          send(ws, {
            ready: {
              model: env.liveModel,
              inputHz: INPUT_HZ,
              outputHz: OUTPUT_HZ,
              ...(env.production ? {} : { fake: true as const }),
            },
          });
        },
        onPcm(pcm) {
          spokenHangup.onPcm();
          send(ws, { pcm });
        },
        onInterrupted() {
          spokenHangup.onInterrupted();
          send(ws, { interrupted: true });
          commitOpen("model");
        },
        onUserTranscript(text, finished) {
          emitTranscript("user", text, finished);
        },
        onModelTranscript(text, finished) {
          emitTranscript("model", text, finished);
        },
        onTurnComplete() {
          spokenHangup.onTurnComplete();
          commitOpen();
        },
        onResumeHandle(handle) {
          send(ws, { resumeHandle: handle });
        },
        onToolCall(call) {
          if (cancelled.has(call.id) || !slot.live) return;

          if (call.name === END_THIS_CONVERSATION) {
            // Arm before the tool result so a fake/local backend that speaks
            // the farewell synchronously is still counted as farewell audio.
            // Not a plan: leaving must not confirm, decline, or execute.
            if (cancelled.has(call.id)) return;
            spokenHangup.arm(call.id);
            slot.live.sendToolResult(call.id, call.name, HANGUP_TOOL_RESULT);
            return;
          }

          if (call.name === THEY_SAID_YES || call.name === THEY_SAID_NO) {
            const live = slot.live;
            void runSpokenDecision({
              ws,
              live,
              uid,
              sessionId,
              call,
              cancelled,
              kind: call.name === THEY_SAID_YES ? "confirmed" : "declined",
            });
            return;
          }

          // A read answers from here and never reaches the planner: one hop
          // instead of two, and it cannot change anything -- which is why it
          // needs no confirmation and none is asked for.
          if (READ_TOOL_NAMES.has(call.name)) {
            const live = slot.live;
            void runReadTool(uid, call.name, call.args).then((result) => {
              if (cancelled.has(call.id)) return;
              live.sendToolResult(call.id, call.name, result);
            });
            return;
          }

          void runPlanTurn({
            ws,
            live: slot.live,
            uid,
            sessionId,
            call,
            cancelled,
          });
        },
        onToolCancel(ids) {
          spokenHangup.onCancel(ids);
          for (const id of ids) cancelled.add(id);
        },
        onError(message) {
          send(ws, { error: { code: "voice_unavailable", message } });
        },
        onClose(reason) {
          send(ws, { closing: { reason } });
          if (ws.readyState === WebSocket.OPEN) {
            // 4000: the client must idle, not reconnect. A dropped frame of
            // `{ closing }` otherwise looks like a network blip.
            ws.close(reason === "hangup" ? 4000 : 1000, reason.slice(0, 120));
          }
        },
      },
    });
  } catch (err) {
    console.warn(`[voice] live session refused: ${(err as Error).message}`);
    send(ws, {
      error: {
        code: "voice_unavailable",
        message: "Voice is not available right now. You can keep typing.",
      },
    });
    ws.close(1013, "voice_unavailable");
    return;
  }

  ws.on("message", (data) => {
    const msg = parseJson(data);
    if (isPcmMessage(msg)) {
      slot.live?.sendPcm(msg.pcm);
      return;
    }
    if (msg && typeof msg === "object" && "hangup" in msg) {
      spokenHangup.dispose();
      slot.live?.close();
      ws.close();
    }
  });

  // Voice minutes are metered here because here is the only place that knows.
  //
  // The relay holds the socket, so the gateway is the only process that can
  // observe how long a session actually lasted. Asking the browser would mean
  // trusting a client to report its own consumption.
  //
  // Measured from the point the session became usable, not from connect: a
  // user should not be billed for the time we spent opening a Vertex session,
  // or for one that never opened at all.
  const startedAt = Date.now();

  ws.on("close", () => {
    spokenHangup.dispose();
    slot.live?.close();

    const seconds = (Date.now() - startedAt) / 1000;
    // Rounded up, and only once a session has lasted long enough to be worth
    // counting. Charging a whole minute for a two-second misfire is the kind
    // of billing detail people notice and resent.
    if (seconds >= 5) {
      void recordUsage(uid, "voice_minutes", Math.ceil(seconds / 60));
    }
  });
}

async function pendingSummary(uid: string, sessionId: string): Promise<string> {
  const session = await getSession(uid, sessionId);
  return session?.companionNote?.trim() || "Should I go ahead?";
}

async function refuseDraftWithoutAddress(opts: {
  live: { sendToolResult: (id: string, name: string, payload: unknown) => void };
  uid: string;
  sessionId: string;
  call: { id: string; name: string };
}): Promise<boolean> {
  const session = await getSession(opts.uid, opts.sessionId);
  if (!composeNeedsAddress(session?.plan ?? [])) return false;
  opts.live.sendToolResult(opts.call.id, opts.call.name, {
    carried_out: false,
    speak:
      "Ask for the recipient's email address before saving. Do not claim the draft was saved.",
  });
  return true;
}

async function runSpokenDecision(opts: {
  ws: WebSocket;
  live: { sendToolResult: (id: string, name: string, payload: unknown) => void };
  uid: string;
  sessionId: string;
  call: { id: string; name: string; args: Record<string, unknown> };
  cancelled: Set<string>;
  kind: "confirmed" | "declined";
}): Promise<void> {
  const { ws, live, uid, sessionId, call, cancelled, kind } = opts;
  try {
    const summary = await pendingSummary(uid, sessionId);
    if (kind === "declined") {
      const result = await declinePendingPlan({
        uid,
        sessionId,
        summary,
        modality: "voice",
      });
      if (cancelled.has(call.id)) return;
      send(ws, { turn: { decision: "done", note: "Stopped. Nothing was changed." } });
      live.sendToolResult(call.id, call.name, {
        carried_out: false,
        stopped: true,
        speak: "Tell them you stopped. Nothing was created, sent, or deleted.",
        did: result.did,
      });
      return;
    }

    if (await refuseDraftWithoutAddress({ live, uid, sessionId, call })) return;

    const result = await carryOutConfirmedPlan({
      uid,
      sessionId,
      summary,
      modality: "voice",
    });
    if (cancelled.has(call.id)) return;
    const note = result.already
      ? "That plan was already carried out."
      : speakActOutcomes(result.did);
    send(ws, { turn: { decision: "done", note, did: result.did } });
    live.sendToolResult(call.id, call.name, {
      carried_out: result.did.length > 0 || result.already,
      already: result.already,
      did: result.did,
      speak:
        "Tell them what happened, in their language. If a step failed, say so. " +
        "Do not claim success this result does not show. Do not ask them to confirm again.",
      note,
    });
  } catch (err) {
    if (cancelled.has(call.id)) return;
    const message = "That could not be carried out just now.";
    send(ws, { error: { code: "internal", message } });
    live.sendToolResult(call.id, call.name, { error: (err as Error).message, cannot: message });
  }
}

async function runPlanTurn(opts: {
  ws: WebSocket;
  live: { sendToolResult: (id: string, name: string, payload: unknown) => void };
  uid: string;
  sessionId: string;
  call: { id: string; name: string; args: Record<string, unknown> };
  cancelled: Set<string>;
}): Promise<void> {
  const { ws, live, uid, sessionId, call, cancelled } = opts;
  if (call.name !== "plan_turn") {
    live.sendToolResult(call.id, call.name, { error: "unknown tool" });
    return;
  }

  const request = typeof call.args.request === "string" ? call.args.request.trim() : "";
  if (!request) {
    live.sendToolResult(call.id, call.name, { error: "empty request" });
    return;
  }

  // A spoken yes used to be planned as a new request. The planner had no
  // thread (voice did not persist one) and asked what they meant — which is
  // how "Yes, please" became "How would you like me to help with your calendar?"
  if (isSpokenYes(request)) {
    if (await refuseDraftWithoutAddress({ live, uid, sessionId, call })) return;
    const result = await carryOutConfirmedPlan({
      uid,
      sessionId,
      summary: await pendingSummary(uid, sessionId),
      modality: "voice",
    });
    if (result.did.length > 0 || result.already) {
      if (cancelled.has(call.id)) return;
      const note = result.already
        ? "That plan was already carried out."
        : speakActOutcomes(result.did);
      send(ws, { turn: { decision: "done", note, did: result.did } });
      live.sendToolResult(call.id, call.name, {
        decision: "done",
        did: result.did,
        already: result.already,
        note,
        speak:
          "The plan they confirmed has been carried out. Tell them what happened. " +
          "Do not ask them to confirm again.",
      });
      return;
    }
  }

  if (isSpokenNo(request)) {
    await declinePendingPlan({
      uid,
      sessionId,
      summary: await pendingSummary(uid, sessionId),
      modality: "voice",
    });
    if (cancelled.has(call.id)) return;
    send(ws, { turn: { decision: "done", note: "Stopped. Nothing was changed." } });
    live.sendToolResult(call.id, call.name, {
      decision: "done",
      stopped: true,
      speak: "Tell them you stopped. Nothing was created, sent, or deleted.",
    });
    return;
  }

  try {
    const session = await getSession(uid, sessionId);
    const follow = composeFollowUpTurn(session?.plan ?? [], request);
    if (follow) {
      const companionNote = follow.confirm.summary;
      try {
        await touchSession(uid, sessionId, {
          utterance: request,
          plan: follow.plan,
          companionNote,
        });
      } catch (err) {
        console.error("[voice] persist compose follow-up", sessionId, err);
      }
      try {
        await appendThread(uid, sessionId, [
          { role: "user", text: request, at: new Date().toISOString() },
          {
            role: "agent",
            text: companionNote,
            at: new Date().toISOString(),
            phase: "confirm",
            options: follow.confirm.options,
            actions: follow.confirm.actions,
            steps: follow.plan,
          },
        ]);
      } catch (err) {
        console.error("[voice] persist compose thread", sessionId, err);
      }
      if (cancelled.has(call.id)) return;
      send(ws, {
        turn: {
          decision: "confirm",
          plan: follow.plan,
          confirm: follow.confirm,
          note: companionNote,
        },
      });
      live.sendToolResult(call.id, call.name, {
        ...follow,
        speak:
          "The overlay form has been updated with what they just said. Speak the subject and a short body. " +
          "If you still need the email address, ask for it. Do not start a new email, and do not ask them " +
          "to confirm a second save as if this were a different draft.",
      });
      return;
    }

    const context = await loadTurnContext(uid, sessionId, request);
    const result = await runTurn(context);
    if (cancelled.has(call.id)) return;
    const stored = overlayConfirmOnPlan(result.plan, result.confirm?.actions ?? []);
    const aligned = { ...result, plan: stored };
    const companionNote =
      aligned.note || result.confirm?.summary || result.clarify?.question || undefined;
    try {
      await touchSession(uid, sessionId, {
        utterance: request,
        plan: stored.length > 0 ? stored : undefined,
        companionNote,
      });
    } catch (err) {
      console.error("[voice] persist turn", sessionId, err);
    }
    // Same thread typed chat already keeps, so a follow-up is not planned as
    // if the meeting details had never been said. Awaited so a spoken yes
    // that follows immediately still finds the plan.
    try {
      await appendThread(uid, sessionId, [
        { role: "user", text: request, at: new Date().toISOString() },
        ...(companionNote
          ? [
              {
                role: "agent" as const,
                text: companionNote,
                at: new Date().toISOString(),
                phase:
                  result.decision === "confirm"
                    ? ("confirm" as const)
                    : result.decision === "clarify"
                      ? ("clarify" as const)
                      : ("done" as const),
                options: result.confirm?.options ?? result.clarify?.options,
                actions: result.confirm?.actions,
                steps: stored.length > 0 ? stored : undefined,
              },
            ]
          : []),
      ]);
    } catch (err) {
      console.error("[voice] persist thread", sessionId, err);
    }
    if (cancelled.has(call.id)) return;
    send(ws, { turn: aligned });
    live.sendToolResult(call.id, call.name, aligned);
  } catch (err) {
    if (cancelled.has(call.id)) return;
    const message = "The planner could not finish this turn.";
    send(ws, { error: { code: "internal", message } });
    live.sendToolResult(call.id, call.name, { error: (err as Error).message });
  }
}
