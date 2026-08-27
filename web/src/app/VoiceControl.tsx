import { Mic, Loader2, Square } from "lucide-react";

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
  // "Cancel" while connecting, because the button remains pressable — see below.
  const label = live
    ? "Stop voice session"
    : connecting
      ? "Cancel connecting"
      : "Start a voice session";
  const box = size === "lg" ? "size-14" : size === "sm" ? "size-9" : "size-11";
  const icon = size === "lg" ? "size-6" : "size-5";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={live}
        // Deliberately NOT disabled while connecting.
        //
        // On a phone this step can take seconds — a permission sheet, a cold
        // service — and a dead button with a muted-microphone icon reads as
        // "voice is off and broken". Leaving it pressable means a connection
        // that stalls can be abandoned instead of forcing a page reload.
        onClick={() => voice.start()}
        className={cn(
          "sheen relative isolate grid place-items-center overflow-hidden rounded-full text-white shadow-e2 transition-transform hover:scale-105 active:scale-95 disabled:opacity-60",
          box,
          // Three states, three appearances. Connecting previously looked
          // identical to idle apart from the icon.
          live ? "bg-destructive" : connecting ? "bg-slate/70" : "bg-slate",
        )}
      >
        {live ? (
          <Square className={cn("relative z-10", icon === "size-6" ? "size-5" : "size-4")} aria-hidden />
        ) : connecting ? (
          // A spinner, not a crossed-out microphone. `MicOff` is the icon for
          // "muted", and using it for "connecting" told the user the opposite of
          // what was happening.
          <Loader2
            className={cn("relative z-10 animate-spin motion-reduce:animate-none", icon)}
            aria-hidden
          />
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
