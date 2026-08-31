import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Mic, MicOff, Plus, Square } from "lucide-react";
import { useLocation } from "react-router";

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
import { useCompanionThread } from "@/app/companion-thread";
import { useAsync } from "@/app/use-async";
import { api, type Session } from "@/app/data";
import { workIdFromPath } from "@/app/work-id";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The live voice session, on one thread at a time.
 *
 * Spoken sessions are their own list. Opening Speak from Today must not
 * hydrate the typed companion chat into the overlay, and must not reopen
 * the last spoken thread. Each tap from idle allocates a new session.
 * Previous conversations sit on a second pill. Opening one hangs this live
 * session and starts on that thread. Plus does the same while already speaking.
 *
 * Pause stops the room reaching the model without hanging up; Stop tears
 * the session down. Saying goodbye does the same as Stop once the farewell
 * has played.
 */
export function VoiceSessionOverlay() {
  const t = useT();
  const voice = useVoice();
  const open = voice.status !== "idle";
  const live = voice.status === "live";
  const connecting = voice.status === "connecting";
  const [mode, setMode] = useState<"speaking" | "history">("speaking");
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (!open) setMode("speaking");
  }, [open]);

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
        instant
        showCloseButton={false}
        overlayClassName="z-[60] bg-black/50"
        className={cn(
          "z-[60] flex flex-col gap-0 p-0",
          "top-0 left-0 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none",
          "sm:top-1/2 sm:left-1/2 sm:h-[min(40rem,90dvh)] sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-brand-lg",
        )}
        aria-labelledby="voice-session-title"
      >
        <header
          className="flex shrink-0 flex-col gap-3 border-b px-5 py-4"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div className="flex items-center gap-2">
            <LogoMark className="size-8 shrink-0" />
            <VoicePanelSwitch mode={mode} onMode={setMode} />
            <button
              type="button"
              disabled={connecting || fresh}
              onClick={() => {
                setMode("speaking");
                setFresh(true);
                void voice.startFresh().finally(() => setFresh(false));
              }}
              aria-label={t("voice.newSession")}
              title={t("voice.newSession")}
              className="grid size-8 shrink-0 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Plus className="size-[18px]" aria-hidden="true" />
            </button>
          </div>
          <div className="min-w-0">
            <DialogTitle id="voice-session-title" className="text-[18px] font-semibold">
              {mode === "speaking" ? t("voice.sessionTitle") : t("voice.previousSessions")}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {mode === "history"
                ? t("voice.previousHint")
                : voice.continued
                  ? t("voice.continuing")
                  : t("voice.sessionHint")}
            </DialogDescription>
            {mode === "speaking" ? (
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
            ) : null}
          </div>
        </header>

        {mode === "speaking" ? (
          <VoiceCaptions variant="session" className="min-h-0 flex-1 px-6 py-4" />
        ) : (
          <VoicePreviousSessions
            currentId={voice.sessionId}
            onOpen={(id) => {
              setMode("speaking");
              if (id !== voice.sessionId) voice.switchTo(id);
            }}
          />
        )}

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

function VoicePanelSwitch({
  mode,
  onMode,
}: {
  mode: "speaking" | "history";
  onMode: (mode: "speaking" | "history") => void;
}) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label={t("voice.sessionTabs")}
      className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full border p-0.5"
    >
      {(["speaking", "history"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onMode(value)}
          className={cn(
            "min-w-0 flex-1 truncate rounded-full px-2.5 py-1 text-[12px] transition-colors",
            mode === value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === "speaking" ? t("voice.currentSession") : t("voice.previousSessions")}
        </button>
      ))}
    </div>
  );
}

function VoicePreviousSessions({
  currentId,
  onOpen,
}: {
  currentId: string;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const { chatsVersion } = useCompanionThread();
  const surface = workIdFromPath(pathname) ? "work" : "voice";
  const { state } = useAsync(() => api.sessions(surface), [chatsVersion, surface, currentId]);
  const sessions: Session[] = state.status === "ready" ? state.data : [];

  if (state.status === "loading") {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-brand bg-muted" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[14px] font-medium">{t("voice.previousEmpty")}</p>
        <p className="text-[13px] text-muted-foreground">{t("voice.previousHint")}</p>
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            onClick={() => onOpen(session.id)}
            className={cn(
              "flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50",
              session.id === currentId && "bg-muted/60",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{session.title}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {session.updatedAt ? relativeTime(session.updatedAt) : ""}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
