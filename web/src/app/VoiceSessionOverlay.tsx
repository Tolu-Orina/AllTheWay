import { Loader2, Mic, MicOff, Square } from "lucide-react";

import { LogoMark } from "@/components/primitives/logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { VoiceCaptions } from "@/app/VoiceControl";
import { useT } from "@/app/i18n";
import { useVoice } from "@/app/use-voice";
import { cn } from "@/lib/utils";

/**
 * The live voice session, on the same companion thread.
 *
 * Captions are the surface. Pause stops the room reaching the model without
 * hanging up; Stop tears the session down. Saying goodbye does the same as
 * Stop once the farewell has played — the model calls `end_this_conversation`,
 * the gateway closes the socket, and this overlay follows. The thread stays
 * in the companion either way — this is not a second conversation.
 *
 * Not stacked on other dialogs: Speak closes the to-do picker first, then
 * `start()` flips status off idle and this opens.
 */
export function VoiceSessionOverlay() {
  const t = useT();
  const voice = useVoice();
  const open = voice.status !== "idle";
  const live = voice.status === "live";
  const connecting = voice.status === "connecting";

  const status =
    voice.status === "error"
      ? voice.error
      : voice.muted && live
        ? t("voice.muted")
        : connecting
          ? t("voice.connecting")
          : t("voice.listening");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) voice.stop();
      }}
      disablePointerDismissal
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[60] bg-black/50 supports-backdrop-filter:backdrop-blur-sm"
        className={cn(
          "z-[60] flex flex-col gap-0 p-0",
          "top-0 left-0 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none",
          "sm:top-1/2 sm:left-1/2 sm:h-[min(40rem,90dvh)] sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-brand-lg",
        )}
        aria-labelledby="voice-session-title"
      >
        <header
          className="flex shrink-0 items-start gap-3 border-b px-5 py-4"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <LogoMark className="mt-0.5 size-8" />
          <div className="min-w-0">
            <DialogTitle id="voice-session-title" className="text-[18px] font-semibold">
              {t("voice.sessionTitle")}
            </DialogTitle>
            <DialogDescription className="mt-1">{t("voice.sessionHint")}</DialogDescription>
            <p
              role="status"
              className={cn(
                "mt-2 text-[13px]",
                voice.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {connecting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  {status}
                </span>
              ) : (
                status
              )}
            </p>
          </div>
        </header>

        <VoiceCaptions variant="session" className="min-h-0 flex-1 px-5 py-4" />

        <footer
          className="shrink-0 border-t px-5 py-4"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!live}
              aria-pressed={live ? voice.muted : undefined}
              aria-label={voice.muted ? t("voice.resumeListening") : t("voice.pauseListening")}
              onClick={() => voice.toggleMute()}
              className={cn(
                "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-brand border px-3 py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-40",
                voice.muted && live
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "bg-card hover:bg-muted",
              )}
            >
              {voice.muted ? (
                <MicOff className="size-4" aria-hidden="true" />
              ) : (
                <Mic className="size-4" aria-hidden="true" />
              )}
              {voice.muted ? t("voice.resumeListening") : t("voice.pauseListening")}
            </button>
            <button
              type="button"
              aria-label={connecting ? t("voice.cancelConnecting") : t("voice.stopSession")}
              onClick={() => voice.stop()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-brand bg-navy-deep px-3 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Square className="size-3.5" aria-hidden="true" />
              {connecting ? t("voice.cancelConnecting") : t("voice.stop")}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
