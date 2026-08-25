import { Mic, MicOff, Square } from "lucide-react";

import { useVoice } from "@/app/use-voice";
import { cn } from "@/lib/utils";

/**
 * Talk to the companion. The socket goes to our gateway; the model credential
 * never leaves the server (ADR 0006). There is no language picker — native
 * audio follows whatever language is being spoken.
 */
export function VoiceControl({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const voice = useVoice();
  const live = voice.status === "live";
  const connecting = voice.status === "connecting";
  const label =
    live ? "Stop voice session" : connecting ? "Connecting voice" : "Start a voice session";
  const box = size === "lg" ? "size-14" : size === "sm" ? "size-9" : "size-11";
  const icon = size === "lg" ? "size-6" : "size-5";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={live}
        disabled={connecting}
        onClick={() => voice.start()}
        className={cn(
          "sheen relative isolate grid place-items-center overflow-hidden rounded-full text-white shadow-e2 transition-transform hover:scale-105 active:scale-95 disabled:opacity-60",
          box,
          live ? "bg-destructive" : "bg-slate",
        )}
      >
        {live ? (
          <Square className={cn("relative z-10", icon === "size-6" ? "size-5" : "size-4")} aria-hidden />
        ) : connecting ? (
          <MicOff className={cn("relative z-10 animate-pulse", icon)} aria-hidden />
        ) : (
          <Mic className={cn("relative z-10", icon)} aria-hidden />
        )}
      </button>
      {voice.status === "error" ? (
        <p role="status" className="max-w-[14rem] text-right text-[12px] leading-snug text-destructive">
          {voice.error}
        </p>
      ) : voice.fake && live ? (
        <p className="text-[11px] text-muted-foreground">Local voice — no model</p>
      ) : null}
    </div>
  );
}

export function VoiceCaptions() {
  const voice = useVoice();
  if (voice.status !== "live" && voice.status !== "error") return null;
  if (!voice.userText && !voice.modelText && !voice.turn) return null;

  return (
    <div className="px-4 pb-2">
    <div className="rounded-brand border bg-background px-3 py-2 text-[13px] leading-relaxed">
      {voice.userText ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">You. </span>
          {voice.userText}
        </p>
      ) : null}
      {voice.modelText ? (
        <p className={cn(voice.userText && "mt-1.5")}>{voice.modelText}</p>
      ) : null}
      {voice.turn?.summary ? (
        <p className="mt-1.5 font-medium">{voice.turn.summary}</p>
      ) : null}
      {voice.turn?.question ? (
        <p className="mt-1.5">{voice.turn.question}</p>
      ) : null}
    </div>
    </div>
  );
}
