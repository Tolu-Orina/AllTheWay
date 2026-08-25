import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { openVoiceSocket, type VoiceSocket } from "@/lib/voice";
import { api } from "@/app/data";

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
  start: () => void;
  stop: () => void;
};

const VoiceContext = createContext<VoiceState | null>(null);

export function useVoice(): VoiceState {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used within VoiceProvider");
  return ctx;
}

async function resolveSessionId(): Promise<string> {
  try {
    const rows = await api.sessions();
    return rows.find((s) => s.done < s.total)?.id ?? rows[0]?.id ?? "live";
  } catch {
    return "live";
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState("");
  const [userText, setUserText] = useState("");
  const [modelText, setModelText] = useState("");
  const [fake, setFake] = useState(false);
  const [turn, setTurn] = useState<VoiceTurn | null>(null);

  const socket = useRef<VoiceSocket | null>(null);
  const graph = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    play: AudioWorkletNode;
  } | null>(null);

  const teardown = useCallback(() => {
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
    setStatus("idle");
  }, [teardown]);

  const start = useCallback(() => {
    if (status === "connecting" || status === "live") {
      stop();
      return;
    }

    void (async () => {
      setStatus("connecting");
      setError("");
      setUserText("");
      setModelText("");
      setTurn(null);
      setFake(false);

      try {
        const sessionId = await resolveSessionId();
        const ctx = new AudioContext();
        await ctx.resume();
        await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
        await ctx.audioWorklet.addModule("/worklets/pcm-play.js");

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const source = ctx.createMediaStreamSource(stream);
        const capture = new AudioWorkletNode(ctx, "pcm-capture");
        const play = new AudioWorkletNode(ctx, "pcm-play");
        source.connect(capture);
        play.connect(ctx.destination);
        graph.current = { ctx, stream, play };

        const voice = await openVoiceSocket(sessionId, {
          onReady(ready) {
            setFake(ready.fake === true);
            setStatus("live");
          },
          onPcm(pcm) {
            play.port.postMessage(pcm);
          },
          onInterrupted() {
            play.port.postMessage("flush");
          },
          onTranscript(side, text) {
            if (side === "user") setUserText(text);
            else setModelText(text);
          },
          onTurn(event) {
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
            setError(message);
            setStatus("error");
          },
          onClose() {
            /* hangup path sets idle in stop() */
          },
        });

        socket.current = voice;
        capture.port.onmessage = (ev) => {
          const data = ev.data;
          if (data instanceof Int16Array) voice.sendPcm(data);
        };
      } catch (err) {
        teardown();
        const name = (err as DOMException)?.name;
        setStatus("error");
        setError(
          name === "NotAllowedError"
            ? "Microphone permission is needed to talk."
            : "Voice is not available right now. You can keep typing.",
        );
      }
    })();
  }, [status, stop, teardown]);

  return (
    <VoiceContext.Provider
      value={{ status, error, userText, modelText, fake, turn, start, stop }}
    >
      {children}
    </VoiceContext.Provider>
  );
}
