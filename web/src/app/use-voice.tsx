import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";

import { PlanStepSchema, type PlanStep } from "@alltheway/contracts";
import { openVoiceSocket, applyVoiceCaption, captionsFromThread, speakGreeting, cancelGreeting, spokenGreetingLine, cueVoiceStart, isGreetingEchoTranscript, type VoiceLine, type VoiceSocket } from "@/lib/voice";
import { useT } from "@/app/i18n";
import { resolveVoiceSessionId, workIdFromPath, readVoiceSessionId, persistVoiceSessionId } from "@/app/work-id";
import { api } from "@/app/data";
import { firstNameFor, useAppUser } from "@/app/user";

export type VoiceStatus = "idle" | "connecting" | "live" | "error";

export type VoiceTurn = {
  decision?: string;
  summary?: string;
  question?: string;
  note?: string;
  options?: string[];
  plan?: PlanStep[];
  actions?: {
    label: string;
    action: string;
    reason: string;
    connector?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
  }[];
};

type VoiceState = {
  status: VoiceStatus;
  error: string;
  lines: VoiceLine[];
  /** True when this overlay opened onto a stored thread, not a blank start. */
  continued: boolean;
  fake: boolean;
  turn: VoiceTurn | null;
  sessionId: string;
  muted: boolean;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
  /** Hang up this thread and speak on another. Overlay stays open. */
  switchTo: (sessionId: string) => void;
  /** New isolated thread, then speak there. */
  startFresh: () => Promise<void>;
};

const VoiceContext = createContext<VoiceState | null>(null);

export function useVoice(): VoiceState {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used within VoiceProvider");
  return ctx;
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAppUser();
  const [voiceSessionId, setVoiceSessionId] = useState(readVoiceSessionId);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [continued, setContinued] = useState(false);
  const [fake, setFake] = useState(false);
  const [turn, setTurn] = useState<VoiceTurn | null>(null);
  const [muted, setMuted] = useState(false);

  /**
   * Which attempt is current.
   *
   * `start` is an async sequence — permission, an AudioContext, two worklets, a
   * session lookup, a socket — and none of it was cancellable. Pressing stop
   * during it ran teardown, and then the sequence carried on and installed the
   * socket and the audio graph it had already built, with `onReady` setting the
   * status back to "live". The session came back after the user stopped it,
   * which is indistinguishable from a stop button that does not work.
   *
   * Every start takes the next number. Anything it produces is discarded unless
   * its number is still the current one.
   */
  const epoch = useRef(0);

  const mutedRef = useRef(false);
  const hangingUp = useRef(false);
  const linesRef = useRef<VoiceLine[]>([]);
  // Set of all texts already persisted as captions this session. Not reset
  // on reconnect so the same utterance cannot be stored twice if the socket
  // drops and comes back with the same final transcript.
  const spokenTexts = useRef<Set<string>>(new Set());
  const greetingFinished = useRef(false);
  const heardModel = useRef(false);
  /** Mic stays down until the hello has finished playing out the speakers. */
  const micHeld = useRef(true);
  const micHoldTimer = useRef<number | null>(null);
  /** Closes an in-flight Live handshake that is not on `socket` yet. */
  const startAbort = useRef<AbortController | null>(null);

  const socket = useRef<VoiceSocket | null>(null);
  const graph = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    play: AudioWorkletNode;
  } | null>(null);

  const teardown = useCallback(() => {
    // Invalidate any start still running: it will drop what it built.
    epoch.current += 1;
    mutedRef.current = false;
    hangingUp.current = false;
    heardModel.current = false;
    micHeld.current = true;
    if (micHoldTimer.current !== null) {
      window.clearTimeout(micHoldTimer.current);
      micHoldTimer.current = null;
    }
    startAbort.current?.abort();
    startAbort.current = null;
    cancelGreeting();
    socket.current?.hangup();
    socket.current = null;
    const g = graph.current;
    graph.current = null;
    g?.stream.getTracks().forEach((t) => t.stop());
    void g?.ctx.close();
  }, []);

  const greetNow = useCallback(() => {
    const line = spokenGreetingLine({ firstName: firstNameFor(user), resumed: false });
    greetingFinished.current = false;
    const next = applyVoiceCaption(linesRef.current, "model", line, true);
    linesRef.current = next;
    setLines(next);
    if (!spokenTexts.current.has(line)) {
      spokenTexts.current.add(line);
    }
    void speakGreeting(line).then(() => {
      greetingFinished.current = true;
      socket.current?.sendGreetingDone();
      micHeld.current = false;
    });
  }, [user]);

  useEffect(() => () => teardown(), [teardown]);

  useEffect(() => {
    void fetch("/worklets/pcm-capture.js?v=2");
    void fetch("/worklets/pcm-play.js?v=3");
  }, []);

  const stop = useCallback(() => {
    teardown();
    setMuted(false);
    setStatus("idle");
    setTurn(null);
    linesRef.current = [];
    setLines([]);
    setContinued(false);
    spokenTexts.current.clear();
  }, [teardown]);

  /**
   * Stop it hearing the room, without ending the conversation.
   *
   * The live model answers whatever the microphone picks up. It has no idea who
   * is speaking, so turning to talk to somebody else means it answers them —
   * which is what happened. Muting halts audio going upstream and flushes what
   * is already queued to play, so it stops mid-sentence rather than finishing a
   * reply to a conversation it was never part of.
   */
  const toggleMute = useCallback(() => {
    setMuted((was) => {
      const now = !was;
      mutedRef.current = now;
      if (now) graph.current?.play.port.postMessage("flush");
      return now;
    });
  }, []);

  const begin = useCallback(
    (sessionId: string, existingCtx?: AudioContext) => {
      const mine = ++epoch.current;
      const current = () => epoch.current === mine;
      const ac = new AbortController();
      startAbort.current = ac;

      void (async () => {
        hangingUp.current = false;

        try {
        // AudioContext must be constructed in the tap. Handshake, mic, and
        // worklets start before the overlay setState so the Dialog paint does
        // not sit in front of the Live connect.
        const ctx = existingCtx ?? new AudioContext({ latencyHint: "interactive" });
        void ctx.resume().then(() => {
          if (current()) cueVoiceStart(ctx);
        });
        try {
          performance.mark("voice-tap");
        } catch {
          /* mark is optional */
        }

        let playNode: AudioWorkletNode | undefined;
        const pcmQ: Int16Array[] = [];
        const MAX_Q = 250;

        const pushPlay = (msg: Int16Array | "flush") => {
          if (playNode) {
            playNode.port.postMessage(msg);
            return;
          }
          if (msg instanceof Int16Array) {
            if (pcmQ.length >= MAX_Q) pcmQ.shift();
            pcmQ.push(msg);
          }
        };

        let voice: VoiceSocket | undefined;
        let stream: MediaStream | undefined;

        try {
          const voiceP = openVoiceSocket(
            sessionId,
            {
              onReady(ready) {
                if (!current()) return;
                setFake(ready.fake === true);
                setStatus("live");
                heardModel.current = false;
                micHeld.current = true;
                if (ready.fake === true) {
                  greetNow();
                  return;
                }
                if (micHoldTimer.current !== null) window.clearTimeout(micHoldTimer.current);
                micHoldTimer.current = window.setTimeout(() => {
                  if (current()) micHeld.current = false;
                }, 12_000);
              },
              onPcm(pcm) {
                if (!current() || mutedRef.current || hangingUp.current) return;
                if (!heardModel.current) {
                  try {
                    performance.mark("voice-first-audio");
                    performance.measure("ttfac", "voice-tap", "voice-first-audio");
                  } catch {
                    /* marks are optional */
                  }
                }
                heardModel.current = true;
                cancelGreeting();
                pushPlay(pcm);
                if (micHoldTimer.current !== null) window.clearTimeout(micHoldTimer.current);
                micHoldTimer.current = window.setTimeout(() => {
                  if (current()) micHeld.current = false;
                }, 800);
              },
              onInterrupted() {
                if (!current()) return;
                pushPlay("flush");
              },
              onTranscript(side, text, finished) {
                if (!current()) return;
                if (side === "user" && (micHeld.current || isGreetingEchoTranscript(text))) return;
                const next = applyVoiceCaption(linesRef.current, side, text, finished);
                linesRef.current = next;
                setLines(next);
                if (finished) {
                  const last = [...next].reverse().find((l) => l.side === side);
                  const spoken = last?.text.trim();
                  if (spoken && !spokenTexts.current.has(spoken)) {
                    spokenTexts.current.add(spoken);
                  }
                }
              },
              onTurn(event) {
                if (!current()) return;
                if (event && typeof event === "object") {
                  const rec = event as Record<string, unknown>;
                  const confirm = rec.confirm as
                    | {
                        summary?: string;
                        options?: string[];
                        actions?: {
                          label: string;
                          action: string;
                          reason: string;
                          connector?: string;
                          tool?: string;
                          arguments?: Record<string, unknown>;
                        }[];
                      }
                    | undefined;
                  const clarify = rec.clarify as { question?: string; options?: string[] } | undefined;
                  const plan = Array.isArray(rec.plan)
                    ? rec.plan.flatMap((step) => {
                        const parsed = PlanStepSchema.safeParse(step);
                        return parsed.success ? [parsed.data] : [];
                      })
                    : [];
                  setTurn({
                    decision: typeof rec.decision === "string" ? rec.decision : undefined,
                    summary: confirm?.summary,
                    question: clarify?.question,
                    note: typeof rec.note === "string" ? rec.note : undefined,
                    options: confirm?.options ?? clarify?.options,
                    plan,
                    actions: confirm?.actions ?? [],
                  });
                }
              },
              onError(message) {
                if (!current()) return;
                setError(message);
                setStatus("error");
              },
              onClose(reason) {
                if (!current()) return;
                if (reason === "hangup") {
                  hangingUp.current = true;
                  const g = graph.current;
                  socket.current = null;
                  g?.stream.getTracks().forEach((track) => track.stop());
                  const play = g?.play;
                  if (!play || !g) {
                    teardown();
                    setMuted(false);
                    setTurn(null);
                    setStatus((s) => (s === "error" ? s : "idle"));
                    return;
                  }
                  let finished = false;
                  const finish = () => {
                    if (finished || epoch.current !== mine) return;
                    finished = true;
                    graph.current = null;
                    void g.ctx.close();
                    epoch.current += 1;
                    setMuted(false);
                    setTurn(null);
                    setStatus((s) => (s === "error" ? s : "idle"));
                  };
                  const timer = window.setTimeout(finish, 2_500);
                  play.port.onmessage = (ev) => {
                    if (ev.data && typeof ev.data === "object" && "drained" in ev.data) {
                      window.clearTimeout(timer);
                      finish();
                    }
                  };
                  play.port.postMessage("drain");
                  return;
                }
                teardown();
                setMuted(false);
                setTurn(null);
                setStatus((s) => (s === "error" ? s : "idle"));
              },
            },
            { signal: ac.signal },
          ).then((v) => {
            voice = v;
            return v;
          });

          const micP = navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          const workletsP = Promise.all([
            ctx.audioWorklet.addModule("/worklets/pcm-capture.js?v=2"),
            ctx.audioWorklet.addModule("/worklets/pcm-play.js?v=3"),
          ]);
          const sessionP = api.session(sessionId).catch(() => null);

          setStatus("connecting");
          setError("");
          setTurn(null);
          setFake(false);

          const [gotStream, , detail] = await Promise.all([micP, workletsP, sessionP, voiceP]);
          stream = gotStream;

          if (!current()) {
            voice?.hangup();
            stream.getTracks().forEach((t) => t.stop());
            void ctx.close();
            return;
          }

          const seeded = captionsFromThread(detail?.thread ?? []);
          const hello = spokenGreetingLine({ firstName: firstNameFor(user), resumed: false });
          const lines = spokenTexts.current.has(hello)
            ? applyVoiceCaption(seeded, "model", hello, true)
            : seeded;
          linesRef.current = lines;
          setLines(lines);
          setContinued(seeded.length > 0);

          const source = ctx.createMediaStreamSource(stream);
          const capture = new AudioWorkletNode(ctx, "pcm-capture");
          const play = new AudioWorkletNode(ctx, "pcm-play");
          source.connect(capture);
          play.connect(ctx.destination);
          playNode = play;
          for (const chunk of pcmQ) play.port.postMessage(chunk);
          pcmQ.length = 0;
          graph.current = { ctx, stream, play };

          if (!voice) {
            throw new Error("voice socket missing");
          }
          socket.current = voice;
          if (greetingFinished.current) voice.sendGreetingDone();
          capture.port.onmessage = (ev) => {
            const data = ev.data;
            if (micHeld.current || mutedRef.current || hangingUp.current || !current()) return;
            if (data instanceof Int16Array) voice?.sendPcm(data);
          };
        } catch (err) {
          voice?.hangup();
          stream?.getTracks().forEach((t) => t.stop());
          void ctx.close();
          if (!current() || (err as DOMException)?.name === "AbortError") return;
          throw err;
        }
      } catch (err) {
        if (!current()) return;
        teardown();
        const name = (err as DOMException)?.name;
        setStatus("error");
        setError(
          name === "NotAllowedError" ? t("voice.micDenied") : t("voice.unavailable"),
        );
      }
      })();
    },
    [teardown, t, user, greetNow],
  );

  const rememberVoice = useCallback((id: string) => {
    persistVoiceSessionId(id);
    setVoiceSessionId(id);
  }, []);

  const start = useCallback(() => {
    if (status === "connecting" || status === "live") {
      stop();
      return;
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    void ctx.resume();
    const workId = workIdFromPath(pathname);
    if (workId) {
      begin(workId, ctx);
      return;
    }
    // Each Speak tap from idle is a new conversation. Reusing the stored id
    // hydrated the last thread into this one. Previous is how you reopen.
    const token = epoch.current;
    setStatus("connecting");
    setError("");
    void api
      .createSession("voice")
      .then((created) => {
        if (epoch.current !== token) {
          void ctx.close();
          return;
        }
        rememberVoice(created.id);
        begin(created.id, ctx);
      })
      .catch(() => {
        void ctx.close();
        if (epoch.current !== token) return;
        setStatus("error");
        setError(t("voice.unavailable"));
      });
  }, [status, stop, begin, pathname, rememberVoice, t]);

  const switchTo = useCallback(
    (sessionId: string) => {
      const next = sessionId.trim();
      if (!next) return;
      if (next === resolveVoiceSessionId(pathname, voiceSessionId)) return;
      // Gesture must construct (and resume) AudioContext before any await.
      const ctx = new AudioContext({ latencyHint: "interactive" });
      void ctx.resume();
      if (workIdFromPath(pathname)) {
        navigate(`/app/work/${next}`);
      } else {
        rememberVoice(next);
      }
      teardown();
      setMuted(false);
      setTurn(null);
      spokenTexts.current.clear();
      linesRef.current = [];
      setLines([]);
      begin(next, ctx);
    },
    [pathname, voiceSessionId, navigate, rememberVoice, teardown, begin],
  );

  const startFresh = useCallback(async () => {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    void ctx.resume();
    const token = epoch.current;
    try {
      const onWork = Boolean(workIdFromPath(pathname));
      const created = await api.createSession(onWork ? "work" : "voice");
      if (epoch.current !== token) {
        void ctx.close();
        return;
      }
      if (!created.id) {
        void ctx.close();
        return;
      }
      if (onWork) navigate(`/app/work/${created.id}`);
      else rememberVoice(created.id);
      teardown();
      setMuted(false);
      setTurn(null);
      spokenTexts.current.clear();
      linesRef.current = [];
      setLines([]);
      begin(created.id, ctx);
    } catch {
      void ctx.close();
    }
  }, [pathname, navigate, rememberVoice, teardown, begin]);

  return (
    <VoiceContext.Provider
      value={{
        status,
        error,
        lines,
        continued,
        fake,
        turn,
        sessionId: resolveVoiceSessionId(pathname, voiceSessionId),
        muted,
        start,
        stop,
        toggleMute,
        switchTo,
        startFresh,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
