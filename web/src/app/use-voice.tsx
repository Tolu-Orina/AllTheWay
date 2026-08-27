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

import { openVoiceSocket, type VoiceSocket } from "@/lib/voice";
import { useT } from "@/app/i18n";
import { resolveVoiceSessionId } from "@/app/work-id";

export type VoiceStatus = "idle" | "connecting" | "live" | "error";

export type VoiceTurn = {
  decision?: string;
  summary?: string;
  question?: string;
  note?: string;
  options?: string[];
};

type VoiceState = {
  status: VoiceStatus;
  error: string;
  userText: string;
  modelText: string;
  fake: boolean;
  turn: VoiceTurn | null;
  /** True while the microphone is open but nothing is being sent upstream. */
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
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [userText, setUserText] = useState("");
  const [modelText, setModelText] = useState("");
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

  /** Read by the capture handler, which is not re-created when state changes. */
  const mutedRef = useRef(false);

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
      setUserText("");
      setModelText("");
      setTurn(null);
      setFake(false);

      try {
        // The microphone is asked for FIRST, while the user's tap is still the
        // most recent thing that happened.
        //
        // It used to be fourth: behind a network call to find the session, an
        // AudioContext resume, and two worklet fetches. On a phone that is
        // seconds of nothing before the permission sheet appears, and the user
        // taps again thinking it did not register. Browsers also tie permission
        // prompts to user activation, which repeated awaits can spend.
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
          return;
        }

        const ctx = new AudioContext();
        await ctx.resume();

        const sessionId = resolveVoiceSessionId(pathname);
        await Promise.all([
          ctx.audioWorklet.addModule("/worklets/pcm-capture.js"),
          ctx.audioWorklet.addModule("/worklets/pcm-play.js"),
        ]);

        if (!current()) {
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close();
          return;
        }

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
            if (!current() || mutedRef.current) return;
            play.port.postMessage(pcm);
          },
          onInterrupted() {
            if (!current()) return;
            play.port.postMessage("flush");
          },
          onTranscript(side, text) {
            if (!current()) return;
            if (side === "user") setUserText(text);
            else setModelText(text);
          },
          onTurn(event) {
            if (!current()) return;
            if (event && typeof event === "object") {
              const rec = event as Record<string, unknown>;
              const confirm = rec.confirm as { summary?: string; options?: string[] } | undefined;
              const clarify = rec.clarify as { question?: string; options?: string[] } | undefined;
              setTurn({
                decision: typeof rec.decision === "string" ? rec.decision : undefined,
                summary: confirm?.summary,
                question: clarify?.question,
                note: typeof rec.note === "string" ? rec.note : undefined,
                options: confirm?.options ?? clarify?.options,
              });
            }
          },
          onError(message) {
            if (!current()) return;
            setError(message);
            setStatus("error");
          },
          onClose() {
            // A close we did not ask for — the network dropped, or the upstream
            // session ended. Without this the button still read "live" and
            // pressing it did nothing, because there was nothing left to stop.
            if (!current()) return;
            teardown();
            setMuted(false);
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
          if (mutedRef.current || !current()) return;
          if (data instanceof Int16Array) voice.sendPcm(data);
        };
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
  }, [pathname, status, stop, teardown, t]);

  return (
    <VoiceContext.Provider
      value={{ status, error, userText, modelText, fake, turn, muted, start, stop, toggleMute }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
