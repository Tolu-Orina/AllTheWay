import { Mic, MicOff, Loader2, Square } from "lucide-react";
import { useEffect, useRef } from "react";

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

export function VoiceCaptions({
  variant = "live",
  className,
}: {
  variant?: "live" | "log" | "session";
  className?: string;
}) {
  const t = useT();
  const voice = useVoice();
  const { decide, status: decisionStatus } = useDecision(voice.sessionId);
  const logRef = useRef<HTMLDivElement>(null);

  const open = voice.lines.filter((l) => !l.finished);
  const shown = variant === "live" ? open : voice.lines;
  const confirming = voice.turn?.decision === "confirm";
  const connecting = voice.status === "connecting" && shown.length === 0 && !voice.error;
  const listening =
    voice.status === "live" && shown.length === 0 && !voice.turn && !voice.error;
  const hasBody = shown.length > 0 || !!voice.turn || listening || connecting;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.lines, voice.turn]);

  if (variant !== "session" && (voice.status === "connecting" || voice.status === "live")) {
    return null;
  }
  if (variant !== "session" && !hasBody) return null;

  return (
    <div className={cn(variant === "session" ? "flex min-h-0 flex-col" : "px-4 pb-2", className)}>
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t("voice.captions")}
        className={cn(
          "rounded-brand border bg-background px-3 py-2 text-[13px] leading-relaxed",
          variant === "log" && "max-h-48 overflow-y-auto",
          variant === "session" &&
            "min-h-0 flex-1 overflow-y-auto text-[15px] leading-relaxed",
        )}
      >
        {connecting ? (
          <p className="text-muted-foreground">{t("voice.connecting")}</p>
        ) : null}
        {listening ? (
          <p className="text-muted-foreground">{t("voice.listening")}</p>
        ) : null}
        {shown.map((line) => (
          <p
            key={line.id}
            className={cn(
              line.side === "user" ? "text-muted-foreground" : "text-foreground",
              line.id !== shown[0]?.id && "mt-1.5",
              !line.finished && "opacity-80",
            )}
          >
            {line.side === "user" ? (
              <span className="font-medium text-foreground">{t("voice.you")} </span>
            ) : null}
            {line.text}
            {!line.finished ? (
              <span className="ml-0.5 inline-block h-3 w-0.5 translate-y-px bg-foreground/50 motion-safe:animate-pulse" />
            ) : null}
          </p>
        ))}
        {voice.turn?.summary && !confirming ? (
          <p className="mt-1.5 font-medium">{voice.turn.summary}</p>
        ) : null}
        {voice.turn?.question ? <p className="mt-1.5">{voice.turn.question}</p> : null}
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
              onCorrect={(now) =>
                void decide("corrected", {
                  summary: voice.turn?.summary ?? "Should I go ahead?",
                  actions: voice.turn?.actions ?? [],
                  modality: "voice",
                  now,
                })
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
