import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useT } from "@/app/i18n";
import {
  AlertTriangle,
  Camera,
  Loader2,
  MessageCircle,
  PanelRightClose,
  Send,
  Upload,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/primitives/logo";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CanvasPane } from "@/app/CanvasPane";
import { useAsync } from "@/app/use-async";
import { api } from "@/app/data";
import { askAboutAdded } from "@/app/Documents";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CAMERA_ACCEPT,
  DOCUMENT_MAX_BYTES,
  prepareDocumentUpload,
} from "@/lib/document-file";
import { Recovery } from "@/app/Recovery";
import { failureKindFrom } from "@alltheway/contracts";
import { CitationChip } from "@/app/CitationChip";
import { ConfirmGate, pendingConfirmId } from "@/app/ConfirmGate";
import { PlanStack } from "@/app/PlanStack";
import { useCompanionThread } from "@/app/companion-thread";
import { Markdown } from "@/app/Markdown";
import { VoiceCaptions, VoiceControl } from "@/app/VoiceControl";
import { cn } from "@/lib/utils";

/**
 * The conversation itself, with no opinion about what contains it.
 *
 * Extracted so the sheet is the only presentation of the thread — a second
 * copy of this markup is how a docked column and a sheet used to drift.
 */
export function CompanionConversation({ autoFocus = false }: { autoFocus?: boolean }) {
  const { messages, send, working, steps, decide, decisionStatus } = useCompanionThread();
  // Recovery rows are keyed by turn. Message ids are numbers and restart with
  // each thread, so they are scoped by the session in the path — otherwise two
  // different sessions would write recovery offers under the same id.
  const { pathname } = useLocation();
  const threadId = pathname.match(/^\/app\/work\/([^/]+)$/)?.[1] ?? "home";
  const confirmId = pendingConfirmId(messages);
  const last = messages.at(-1);
  const reduced = useReducedMotion();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, reduced]);

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={cn("flex gap-2.5", m.role === "user" && "justify-end")}
          >
            {m.role === "agent" ? (
              <LogoMark className="mt-0.5 size-6 shrink-0" />
            ) : null}
            <div className="max-w-[19rem]">
              {m.id === confirmId ? null : m.phase === "error" ? null : (
              <div
                className={cn(
                  "rounded-brand px-3 py-2 text-[13.5px] leading-relaxed",
                  m.role === "agent"
                    ? "rounded-tl-sm border bg-background"
                    : "rounded-tr-sm bg-accent text-accent-foreground",
                )}
              >
                {m.role === "agent" ? <Markdown className="md-compact">{m.text}</Markdown> : m.text}
              </div>
              )}

              {m.steps?.length && m.id !== confirmId ? (
                <div className="mt-2">
                  <PlanStack steps={m.steps} />
                </div>
              ) : null}

              {m.id === confirmId ? (
                <div className="mt-2">
                  <ConfirmGate
                    summary={m.text}
                    actions={m.actions ?? []}
                    confirmLabel={m.options?.[0] ?? "Yes, go ahead"}
                    declineLabel={m.options?.[1] ?? "No, stop"}
                    busy={working || Boolean(decisionStatus)}
                    status={decisionStatus}
                    onConfirm={() =>
                      void decide("confirmed", {
                        summary: m.text,
                        actions: m.actions ?? [],
                      })
                    }
                    onDecline={() =>
                      void decide("declined", {
                        summary: m.text,
                        actions: m.actions ?? [],
                      })
                    }
                    onCorrect={(now) => send(now)}
                  />
                </div>
              ) : null}

              {m.actions?.length && m.id !== confirmId ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {m.actions.map((a) => (
                    <li
                      key={a.label}
                      className="flex items-start gap-1.5 text-[12px] text-muted-foreground"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-3 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span>
                        <span className="font-medium text-foreground">{a.label}</span>
                        {a.reason ? ` — ${a.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/*
                A failure with a way forward.
              
                Recovery and its route table have existed since v3 and were
                imported nowhere, so a failed turn showed a message and stopped --
                which is the moment the taxonomy was built for. `turnId` is the
                message id: stable for the life of the thread, which is all the
                recovery ledger needs to tie an offer to what was offered.
              */}
              {m.phase === "error" ? (
                <div className="mt-2">
                  <Recovery
                    kind={failureKindFrom(m.text)}
                    message={m.text}
                    turnId={`${threadId}-${m.id}`}
                    onRetry={() => send(m.text)}
                  />
                </div>
              ) : null}
              
              {m.citations?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.citations.map((c) => (
                    <CitationChip key={c.chunkId} citation={c} />
                  ))}
                </div>
              ) : null}
            </div>
          </motion.div>
        ))}

        {last?.role === "agent" && last.phase === "clarify" && last.options?.length ? (
          <div className="flex flex-wrap gap-2 pl-[34px]">
            {last.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => send(option)}
                disabled={working}
                className="rounded-full border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {working ? (
          <div className="pl-[34px]">
            {steps.length > 0 ? (
              <div className="max-w-[18rem]">
                <PlanStack steps={steps} live />
              </div>
            ) : (
              <p
                role="status"
                className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
              >
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Thinking…
              </p>
            )}
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <VoiceCaptions variant="live" />
      <CompanionComposer autoFocus={autoFocus} />
    </>
  );
}

/**
 * The input. Shared by the panel and by Home below `lg`, so a half-typed
 * message survives moving between them.
 */
export function CompanionComposer({ autoFocus = false }: { autoFocus?: boolean }) {
  const t = useT();
  const { draft, setDraft, send, working } = useCompanionThread();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const acceptDrop = useCallback(
    async (files: FileList) => {
      const file = Array.from(files)[0];
      if (!file || working) return;

      if (file.size > DOCUMENT_MAX_BYTES) {
        setDropNote(
          `${file.name || "That file"} is larger than ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB.`,
        );
        return;
      }

      setDropNote(t("documents.reading", { name: file.name || "photo" }));
      try {
        const prepared = await prepareDocumentUpload(file);
        await api.uploadDocument(prepared.title, prepared.content, prepared.mimeType);
        setDropNote(null);
        send(askAboutAdded(prepared.title));
      } catch (err) {
        setDropNote((err as { message?: string }).message || `${file.name || "That file"} could not be added.`);
      }
    },
    [send, t, working],
  );

  return (
    <>
      {dropNote ? (
        <p role="status" className="border-t px-3 py-2 text-[12.5px] text-muted-foreground">
          {dropNote}
        </p>
      ) : null}

      <form
        className={cn(
          "flex items-center gap-2 border-t p-3 transition-colors",
          dropping && "bg-primary/5 ring-1 ring-primary/40 ring-inset",
        )}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          if (e.dataTransfer.files.length) void acceptDrop(e.dataTransfer.files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {t("common.messageTheCompanion")}
        </label>
        <VoiceControl size="sm" />
        <input
          ref={fileRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          disabled={working}
          onChange={(e) => {
            if (e.target.files) void acceptDrop(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept={DOCUMENT_CAMERA_ACCEPT}
          capture="environment"
          className="sr-only"
          disabled={working}
          onChange={(e) => {
            if (e.target.files) void acceptDrop(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label={t("documents.choose")}
          disabled={working}
          onClick={() => fileRef.current?.click()}
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Upload className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("documents.photograph")}
          disabled={working}
          onClick={() => cameraRef.current?.click()}
          className="hidden size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:grid"
        >
          <Camera className="size-4" aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={working}
          placeholder={
            dropping ? "Drop it here" : working ? "Working…" : t("today.askHere")
          }
          className="min-w-0 flex-1 rounded-full border bg-background px-3.5 py-2 text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!draft.trim() || working}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Send className="size-4" aria-hidden="true" />
        </button>
      </form>
    </>
  );
}

/**
 * The companion: a floating button that opens the conversation over the
 * work, with the page behind it blurred. Full-bleed on a phone, a
 * right-anchored sheet from tablet up. Studio hides the FAB so the stage
 * keeps the width.
 *
 * A docked third column used to take the right side on xl. That squeezed
 * Today into a narrow well and made large screens a different product from
 * the phone. One way in, every size.
 */
export function CompanionPanel() {
  const { pathname } = useLocation();
  const studio = pathname.startsWith("/app/studio");
  const work = pathname.startsWith("/app/work");
  const sessionId = pathname.match(/^\/app\/work\/([^/]+)$/)?.[1];
  const artifacts = useAsync(
    () => (sessionId ? api.artifacts(sessionId) : Promise.resolve([])),
    [sessionId ?? ""],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<"chat" | "work">("chat");
  const { companionOpenNonce } = useCompanionThread();
  const seenOpenNonce = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setMode("chat");
      return;
    }
    if (artifacts.state.status === "ready") {
      setMode(artifacts.state.data.length > 0 ? "work" : "chat");
    }
  }, [sessionId, artifacts.state]);

  useEffect(() => {
    if (studio || work) setSheetOpen(false);
  }, [studio, work]);

  useEffect(() => {
    if (work) return;
    if (companionOpenNonce === 0 || companionOpenNonce === seenOpenNonce.current) return;
    seenOpenNonce.current = companionOpenNonce;
    setMode("chat");
    setSheetOpen(true);
  }, [companionOpenNonce, work]);

  return (
    <>
      {studio || work ? null : (
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Open companion"
        aria-expanded={sheetOpen}
        className="fixed right-4 bottom-[5.75rem] z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-e2 transition-transform hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 lg:right-6 lg:bottom-6"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <MessageCircle className="size-6" aria-hidden="true" />
      </button>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          aria-label="Companion"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[26rem] data-[side=right]:sm:max-w-none"
          overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="sr-only">Companion</h2>
            <PanelSwitch mode={mode} onMode={setMode} />
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close companion"
              className="grid size-8 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelRightClose className="size-[18px]" aria-hidden="true" />
            </button>
          </div>

          {mode === "chat" ? <CompanionConversation autoFocus={sheetOpen} /> : <CanvasPane key={sessionId ?? "all"} sessionId={sessionId} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The panel's two nouns.
 *
 * Deliberately not navigation. The third column has always been here; what
 * changes is whether it is showing the conversation or the thing the
 * conversation is about. A tab bar would imply two places; this implies one
 * place with two views, which is what it is.
 */
function PanelSwitch({
  mode,
  onMode,
}: {
  mode: "chat" | "work";
  onMode: (mode: "chat" | "work") => void;
}) {
  return (
    <div role="tablist" aria-label="Panel view" className="flex items-center gap-0.5 rounded-full border p-0.5">
      {(["chat", "work"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onMode(value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] transition-colors",
            mode === value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === "chat" ? "Chat" : "Work"}
        </button>
      ))}
    </div>
  );
}
