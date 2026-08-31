import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

import { PlanStepSchema, type PlanStep } from "@alltheway/contracts";
import { openVoiceSocket, applyVoiceCaption, captionsFromThread, type VoiceLine, type VoiceSocket } from "@/lib/voice";
import { useT } from "@/app/i18n";
import { resolveVoiceSessionId } from "@/app/work-id";
import { useCompanionThread } from "@/app/companion-thread";
import { api } from "@/app/data";

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
};

const VoiceContext = createContext<VoiceState | null>(null);

export function useVoice(): VoiceState {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used within VoiceProvider");
  return ctx;
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const { recordSpoken, sessionId: companionSessionId } = useCompanionThread();
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
  // Set of all texts already handed to recordSpoken this session. Not reset
  // on reconnect so the same utterance cannot be stored twice if the socket
  // drops and comes back with the same final transcript.
  const spokenTexts = useRef<Set<string>>(new Set());

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
    socket.current?.hangup();
    socket.current = null;
    const g = graph.current;
    graph.current = null;
    g?.stream.getTracks().forEach((t) => t.stop());
    void g?.ctx.close();
  }, []);

  useEffect(() => () => teardown(), [teardown]);

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

  const start = useCallback(() => {
    if (status === "connecting" || status === "live") {
      stop();
      return;
    }

    const mine = ++epoch.current;
    /** False as soon as stop, teardown, or another start has happened. */
    const current = () => epoch.current === mine;

    void (async () => {
      setStatus("connecting");
      setError("");
      hangingUp.current = false;
      setTurn(null);
      setFake(false);

      try {
        // AudioContext is created in the same tap as the permission prompt.
        // On iOS, creating it after `await getUserMedia` spends the user
        // gesture, and playback stays silent — which is the "no audio" report
        // on a phone. Both start on the click stack; we only wait after.
        const ctx = new AudioContext({ latencyHint: "interactive" });
        try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (!current()) {
          // Stopped while the permission sheet was up. Release the microphone
          // rather than leaving the recording indicator on with nothing behind it.
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close();
          return;
        }

        await ctx.resume();

        const sessionId = resolveVoiceSessionId(pathname, companionSessionId);
        const [, , detail] = await Promise.all([
          ctx.audioWorklet.addModule("/worklets/pcm-capture.js?v=2"),
          ctx.audioWorklet.addModule("/worklets/pcm-play.js?v=3"),
          api.session(sessionId).catch(() => null),
        ]);

        if (!current()) {
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close();
          return;
        }

        const seeded = captionsFromThread(detail?.thread ?? []);
        linesRef.current = seeded;
        setLines(seeded);
        setContinued(seeded.length > 0);

        const source = ctx.createMediaStreamSource(stream);
        const capture = new AudioWorkletNode(ctx, "pcm-capture");
        const play = new AudioWorkletNode(ctx, "pcm-play");
        source.connect(capture);
        play.connect(ctx.destination);
        graph.current = { ctx, stream, play };

        const voice = await openVoiceSocket(sessionId, {
          onReady(ready) {
            // The check that stops a cancelled attempt reporting itself live.
            if (!current()) return;
            setFake(ready.fake === true);
            setStatus("live");
          },
          onPcm(pcm) {
            if (!current() || mutedRef.current || hangingUp.current) return;
            play.port.postMessage(pcm);
          },
          onInterrupted() {
            if (!current()) return;
            play.port.postMessage("flush");
          },
          onTranscript(side, text, finished) {
            if (!current()) return;
            const next = applyVoiceCaption(linesRef.current, side, text, finished);
            linesRef.current = next;
            setLines(next);
            if (finished) {
              const last = [...next].reverse().find((l) => l.side === side);
              const spoken = last?.text.trim();
              if (spoken && !spokenTexts.current.has(spoken)) {
                spokenTexts.current.add(spoken);
                recordSpoken(side === "user" ? "user" : "agent", spoken);
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
              // Spoken hang-up (or a server close that used the hangup
              // reason). Stop the mic, keep playing the farewell, then idle.
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
            // A close we did not ask for — the network dropped, or the upstream
            // session ended. Without this the button still read "live" and
            // pressing it did nothing, because there was nothing left to stop.
            teardown();
            setMuted(false);
            setTurn(null);
            setStatus((s) => (s === "error" ? s : "idle"));
          },
        });

        if (!current()) {
          // Stopped while the socket was opening. Hang it up rather than
          // leaving a live session nothing on screen can reach.
          voice.hangup();
          return;
        }

        socket.current = voice;
        capture.port.onmessage = (ev) => {
          const data = ev.data;
          // Muted means the room is not sent upstream at all. Dropping it here
          // rather than at the socket keeps it out of the transcript too.
          if (mutedRef.current || hangingUp.current || !current()) return;
          if (data instanceof Int16Array) voice.sendPcm(data);
        };
        } catch (err) {
          void ctx.close();
          throw err;
        }
      } catch (err) {
        // A cancelled attempt is not a failure, and must not paint one.
        if (!current()) return;
        teardown();
        const name = (err as DOMException)?.name;
        setStatus("error");
        setError(
          name === "NotAllowedError"
            ? t("voice.micDenied")
            : t("voice.unavailable"),
        );
      }
    })();
  }, [pathname, companionSessionId, status, stop, teardown, t, recordSpoken]);

  return (
    <VoiceContext.Provider
      value={{
        status,
        error,
        lines,
        continued,
        fake,
        turn,
        sessionId: resolveVoiceSessionId(pathname, companionSessionId),
        muted,
        start,
        stop,
        toggleMute,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
