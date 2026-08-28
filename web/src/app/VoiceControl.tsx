import { Mic, MicOff, Loader2, Square } from "lucide-react";

import { useVoice } from "@/app/use-voice";
import { useT } from "@/app/i18n";
import { cn } from "@/lib/utils";
import { ConfirmGate } from "@/app/ConfirmGate";
import { PlanStack } from "@/app/PlanStack";
import { useDecision } from "@/app/use-decision";

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
  const t = useT();
  const voice = useVoice();
  const live = voice.status === "live";
  const connecting = voice.status === "connecting";
  // "Cancel" while connecting, because the button remains pressable — see below.
  const label = live
    ? t("voice.stopSession")
    : connecting
      ? t("voice.cancelConnecting")
      : t("voice.startSession");
  const box = size === "lg" ? "size-14" : size === "sm" ? "size-9" : "size-11";
  const icon = size === "lg" ? "size-6" : "size-5";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <div className="flex items-center gap-2">
        {/*
          Stop listening, without hanging up.
          
          The model answers whatever the microphone hears and cannot tell who is
          speaking — so turning to talk to somebody else got an answer meant for
          them. Ending the call to avoid that loses the conversation; this does
          not. Shown only while live, because there is nothing to mute otherwise.
        */}
        {live ? (
          <button
            type="button"
            aria-label={voice.muted ? t("voice.unmute") : t("voice.mute")}
            aria-pressed={voice.muted}
            onClick={() => voice.toggleMute()}
            className={cn(
              "grid size-9 place-items-center rounded-full border transition-colors active:scale-95",
              voice.muted
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {voice.muted ? (
              <MicOff className="size-4" aria-hidden />
            ) : (
              <Mic className="size-4" aria-hidden />
            )}
          </button>
        ) : null}
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
      </div>
      {voice.muted && live ? (
        <p role="status" className="text-[11px] text-destructive">
          {t("voice.muted")}
        </p>
      ) : null}
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
  const { decide, status: decisionStatus } = useDecision(voice.sessionId);
  if (voice.status !== "live" && voice.status !== "error") return null;
  if (!voice.userText && !voice.modelText && !voice.turn) return null;

  const confirming = voice.turn?.decision === "confirm";

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
      {voice.turn?.plan?.length ? (
        <div className="mt-2">
          <PlanStack steps={voice.turn.plan} />
        </div>
      ) : null}
      {confirming ? (
        <div className="mt-2">
          <ConfirmGate
            summary={voice.turn?.summary ?? "Should I go ahead?"}
            actions={voice.turn?.actions ?? []}
            confirmLabel={voice.turn?.options?.[0] ?? "Yes, go ahead"}
            declineLabel={voice.turn?.options?.[1] ?? "No, stop"}
            status={decisionStatus}
            onConfirm={() =>
              void decide("confirmed", {
                summary: voice.turn?.summary ?? "Should I go ahead?",
                actions: voice.turn?.actions ?? [],
                modality: "voice",
              })
            }
            onDecline={() =>
              void decide("declined", {
                summary: voice.turn?.summary ?? "Should I go ahead?",
                actions: voice.turn?.actions ?? [],
                modality: "voice",
              })
            }
          />
        </div>
      ) : null}
    </div>
    </div>
  );
}
