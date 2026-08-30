import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Camera, Loader2, Paperclip, Send } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/primitives/logo";
import { CitationChip } from "@/app/CitationChip";
import { ConfirmGate, pendingConfirmId } from "@/app/ConfirmGate";
import { PlanStack } from "@/app/PlanStack";
import { Recovery } from "@/app/Recovery";
import { SessionTranscript } from "@/app/VoiceTranscripts";
import { askAboutAdded } from "@/app/Documents";
import { api, type SessionDetail } from "@/app/data";
import { failureKindFrom, type ThreadMessage } from "@alltheway/contracts";
import { useAsync } from "@/app/use-async";
import { useDecision } from "@/app/use-decision";
import { useTurn, type ProposedAction, type TurnPhase } from "@/app/use-turn";
import { useStartWork } from "@/app/use-start-work";
import { useT } from "@/app/i18n";
import { composeKind, composeSources } from "@/app/compose-fields";
import { isSpokenYes } from "@/lib/spoken-confirm";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CAMERA_ACCEPT,
  DOCUMENT_MAX_BYTES,
  prepareDocumentUpload,
} from "@/lib/document-file";
import { Markdown } from "@/app/Markdown";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: number;
  role: "agent" | "user";
  text: string;
  phase?: TurnPhase;
  options?: string[];
  actions?: ProposedAction[];
  citations?: ThreadMessage["citations"];
  steps?: ThreadMessage["steps"];
};

function fromStored(thread: ThreadMessage[]): ChatMessage[] {
  const mapped: ChatMessage[] = thread.map((m, i) => ({
    id: i + 1,
    role: m.role,
    text: m.text,
    phase: m.phase,
    options: m.options,
    actions: m.actions,
    citations: m.citations,
    steps: m.steps,
  }));
  const last = mapped[mapped.length - 1];
  // A write plan that later stored as `done` still carries the calls Yes
  // must replay. Show the gate instead of a finished note.
  if (
    last?.role === "agent" &&
    last.actions?.length &&
    last.phase !== "clarify" &&
    last.phase !== "error"
  ) {
    last.phase = "confirm";
  }
  return mapped;
}

function greetingKey(): "today.goodMorning" | "today.goodAfternoon" | "today.goodEvening" {
  const hour = new Date().getHours();
  if (hour < 12) return "today.goodMorning";
  if (hour < 18) return "today.goodAfternoon";
  return "today.goodEvening";
}

function workSeedKey(sessionId: string): string {
  return `atw:work-seed:${sessionId}`;
}

function readWorkSeed(
  sessionId: string,
  locationState: { seed?: string; promptOnly?: boolean } | null,
): { seed: string; promptOnly: boolean } | null {
  try {
    const stored = sessionStorage.getItem(workSeedKey(sessionId));
    if (stored) {
      const parsed = JSON.parse(stored) as { seed?: string; promptOnly?: boolean };
      if (parsed.seed?.trim()) {
        return { seed: parsed.seed.trim(), promptOnly: parsed.promptOnly === true };
      }
    }
  } catch {
    /* private windows */
  }
  const seed = locationState?.seed?.trim();
  if (!seed) return null;
  return { seed, promptOnly: locationState?.promptOnly === true };
}

function clearWorkSeed(sessionId: string) {
  try {
    sessionStorage.removeItem(workSeedKey(sessionId));
  } catch {
    /* private windows */
  }
}

export function WorkChat({
  sessionId,
  onSettled,
}: {
  sessionId?: string;
  onSettled?: () => void;
}) {
  if (!sessionId) return <NewWorkChat />;
  return <SessionWorkChat sessionId={sessionId} onSettled={onSettled} />;
}

function NewWorkChat() {
  const t = useT();
  const { startWork, starting } = useStartWork();
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || starting) return;
    setDraft("");
    void startWork({ seed: trimmed });
  };

  return (
    <section className="flex min-h-[32rem] flex-1 flex-col rounded-brand-lg border bg-card shadow-e1 lg:min-h-[calc(100dvh-11rem)]">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] sm:text-[32px]">
          {t(greetingKey())}.
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          {t("work.getStarted")}
        </p>
      </div>
      <WorkComposer
        draft={draft}
        setDraft={setDraft}
        working={starting}
        onSend={send}
        fileRef={fileRef}
        cameraRef={cameraRef}
        note={note}
        onFiles={async (files) => {
          const file = Array.from(files)[0];
          if (!file) return;
          if (file.size > DOCUMENT_MAX_BYTES) {
            setNote(
              `${file.name || "That file"} is larger than ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB.`,
            );
            return;
          }
          setNote(t("documents.reading", { name: file.name || "photo" }));
          try {
            const prepared = await prepareDocumentUpload(file);
            await api.uploadDocument(prepared.title, prepared.content, prepared.mimeType);
            setNote(null);
            void startWork({ seed: askAboutAdded(prepared.title) });
          } catch (err) {
            setNote((err as { message?: string }).message || `${file.name || "That file"} could not be added.`);
          }
        }}
      />
    </section>
  );
}

function SessionWorkChat({
  sessionId,
  onSettled,
}: {
  sessionId: string;
  onSettled?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, reload } = useAsync<SessionDetail | null>(() => api.session(sessionId), [sessionId]);
  const { turn, send: runTurn } = useTurn(sessionId);
  const { decide, reset: resetDecision, status: decisionStatus } = useDecision(sessionId);
  const seedState = location.state as { seed?: string; promptOnly?: boolean } | null;
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const settled = useRef("");
  const hadTurn = useRef(false);
  const ended = useRef(false);
  const pending = useRef<string[]>([]);
  const draining = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const working = turn.phase === "working";

  useEffect(() => {
    hadTurn.current = false;
    ended.current = false;
    settled.current = "";
    setHistory([]);
    const id = sessionId;
    return () => {
      if (!id || ended.current || !hadTurn.current) return;
      void api.endSession(id).catch(() => {});
    };
  }, [sessionId]);

  useEffect(() => {
    if (state.status !== "ready" || !state.data?.thread.length) return;
    setHistory((prev) => (prev.some((m) => m.role === "user") ? prev : fromStored(state.data!.thread)));
  }, [state]);

  useEffect(() => {
    const found = readWorkSeed(sessionId, seedState);
    if (!found) return;
    navigate(".", { replace: true, state: null });
    if (found.promptOnly) {
      setDraft(found.seed);
      clearWorkSeed(sessionId);
      return;
    }
    hadTurn.current = true;
    setHistory((prev) =>
      prev.some((m) => m.role === "user" && m.text === found.seed)
        ? prev
        : [...prev, { id: prev.length + 1, role: "user", text: found.seed }],
    );
    void runTurn(found.seed);
  }, [sessionId, seedState?.seed, seedState?.promptOnly, runTurn, navigate]);

  useEffect(() => {
    if (
      turn.phase === "confirm" ||
      turn.phase === "done" ||
      turn.phase === "clarify" ||
      turn.phase === "error"
    ) {
      clearWorkSeed(sessionId);
    }
  }, [sessionId, turn.phase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [history, working, reduced]);

  useEffect(() => {
    if (turn.phase === "working" || turn.phase === "idle") return;
    const key = `${turn.request}:${turn.phase}`;
    if (settled.current === key) return;
    settled.current = key;

    const text =
      turn.phase === "clarify"
        ? turn.question
        : turn.phase === "confirm"
          ? turn.summary
          : turn.phase === "error"
            ? turn.error || "Something went wrong and nothing was done. Try again in a moment."
            : turn.note || "Done.";

    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "agent" && last.phase === turn.phase && last.text === text) return prev;
      if (turn.phase === "done" && last?.role === "agent" && last.phase === "confirm") return prev;
      return [
        ...prev,
        {
          id: prev.length + 1,
          role: "agent",
          text,
          phase: turn.phase,
          options: turn.options,
          actions: turn.actions,
          citations: turn.citations,
          steps: turn.steps.length ? turn.steps : undefined,
        },
      ];
    });
    if (turn.phase === "done") {
      onSettled?.();
      void reload();
    }
  }, [turn, onSettled, reload]);

  const send = useCallback(
    (text: string) => {
      let trimmed = text.trim();
      if (!trimmed) return;
      if (working) {
        pending.current.push(trimmed);
        return;
      }
      const lastAgent =
        history.find((m) => m.id === pendingConfirmId(history)) ??
        [...history].reverse().find((m) => m.role === "agent");
      if (
        lastAgent?.actions?.length &&
        (trimmed === "1" || isSpokenYes(trimmed))
      ) {
        hadTurn.current = true;
        setHistory((prev) => [...prev, { id: prev.length + 1, role: "user", text: trimmed }]);
        setDraft("");
        void decide("confirmed", { summary: lastAgent.text, actions: lastAgent.actions }).then(() =>
          onSettled?.(),
        );
        return;
      }
      hadTurn.current = true;
      setHistory((prev) => [...prev, { id: prev.length + 1, role: "user", text: trimmed }]);
      setDraft("");
      if (
        lastAgent?.actions?.some((a) => a.connector && a.tool) &&
        composeKind(composeSources(lastAgent.steps, lastAgent.actions)) !== "email"
      ) {
        void (async () => {
          await decide("corrected", {
            summary: lastAgent.text,
            actions: lastAgent.actions ?? [],
            now: trimmed,
          });
          resetDecision();
          void runTurn(trimmed);
        })();
        return;
      }
      resetDecision();
      void runTurn(trimmed);
    },
    [working, history, decide, resetDecision, runTurn, onSettled],
  );

  useEffect(() => {
    if (turn.phase === "working") {
      draining.current = false;
      return;
    }
    if (turn.phase === "confirm" || turn.phase === "clarify") return;
    if (draining.current) return;
    const next = pending.current[0];
    if (!next) return;
    draining.current = true;
    pending.current = pending.current.slice(1);
    send(next);
  }, [turn.phase, send]);

  const session = state.status === "ready" ? state.data : null;
  const last = history[history.length - 1];
  const confirmId = pendingConfirmId(history);
  const context =
    session && session.title && session.title !== "New work"
      ? t("work.continueRefining", { title: session.title })
      : t("work.getStarted");

  return (
    <section className="flex min-h-[32rem] min-w-0 flex-1 flex-col rounded-brand-lg border bg-card shadow-e1 lg:min-h-[calc(100dvh-11rem)]">
      <header className="border-b px-5 py-4 sm:px-6">
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] sm:text-[28px]">
          {t(greetingKey())}.
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">{context}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
        {history.map((m) => (
          <ChatBubble
            key={m.id}
            message={m}
            confirming={m.id === confirmId}
            working={working}
            decisionStatus={decisionStatus}
            threadId={sessionId}
            onSend={send}
            onConfirm={() => {
              hadTurn.current = true;
              void decide("confirmed", {
                summary: m.text,
                actions: m.actions ?? [],
              }).then(() => onSettled?.());
            }}
            onDecline={() => {
              hadTurn.current = true;
              void decide("declined", {
                summary: m.text,
                actions: m.actions ?? [],
              });
            }}
          />
        ))}

        {last?.role === "agent" && last.phase === "clarify" && last.options?.length ? (
          <div className="flex flex-wrap gap-2 pl-[42px]">
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
          <div className="pl-[42px]">
            {turn.steps.length > 0 ? (
              <div className="max-w-[36rem]">
                <PlanStack steps={turn.steps} live />
              </div>
            ) : (
              <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {t("work.thinking")}
              </p>
            )}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <WorkComposer
        draft={draft}
        setDraft={setDraft}
        working={working}
        onSend={send}
        fileRef={fileRef}
        cameraRef={cameraRef}
        note={note}
        confirmPending={turn.phase === "confirm" || confirmId !== null}
        onFiles={async (files) => {
          const file = Array.from(files)[0];
          if (!file || working) return;
          if (file.size > DOCUMENT_MAX_BYTES) {
            setNote(
              `${file.name || "That file"} is larger than ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB.`,
            );
            return;
          }
          setNote(t("documents.reading", { name: file.name || "photo" }));
          try {
            const prepared = await prepareDocumentUpload(file);
            await api.uploadDocument(prepared.title, prepared.content, prepared.mimeType);
            setNote(null);
            send(askAboutAdded(prepared.title));
          } catch (err) {
            setNote((err as { message?: string }).message || `${file.name || "That file"} could not be added.`);
          }
        }}
      />
      <SessionTranscript sessionId={sessionId} />
    </section>
  );
}

function ChatBubble({
  message: m,
  confirming,
  working,
  decisionStatus,
  threadId,
  onSend,
  onConfirm,
  onDecline,
}: {
  message: ChatMessage;
  confirming: boolean;
  working: boolean;
  decisionStatus: string | null;
  threadId: string;
  onSend: (text: string) => void;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex gap-3", m.role === "user" && "justify-end")}
    >
      {m.role === "agent" ? <LogoMark className="mt-0.5 size-7 shrink-0" /> : null}
      <div className="max-w-[min(42rem,100%)]">
        {confirming ? null : m.phase === "error" ? null : (
          <div
            className={cn(
              "rounded-brand px-3.5 py-2.5 text-[14px] leading-relaxed",
              m.role === "agent"
                ? "rounded-tl-sm border bg-background"
                : "rounded-tr-sm bg-accent text-accent-foreground",
            )}
          >
            {m.role === "agent" ? <Markdown className="md-compact">{m.text}</Markdown> : m.text}
          </div>
        )}
        {m.steps?.length && !confirming ? (
          <div className="mt-2">
            <PlanStack steps={m.steps} />
          </div>
        ) : null}
        {confirming ? (
          <div className="mt-2">
            <ConfirmGate
              summary={m.text}
              actions={m.actions ?? []}
              confirmLabel={m.options?.[0] ?? "Yes, go ahead"}
              declineLabel={m.options?.[1] ?? "No, stop"}
              busy={working || Boolean(decisionStatus)}
              status={decisionStatus}
              sessionId={threadId}
              steps={m.steps}
              onConfirm={onConfirm}
              onDecline={onDecline}
              onCorrect={(now) => onSend(now)}
            />
          </div>
        ) : null}
        {m.phase === "error" ? (
          <div className="mt-2">
            <Recovery
              kind={failureKindFrom(m.text)}
              message={m.text}
              turnId={`${threadId}-${m.id}`}
              onRetry={() => onSend(m.text)}
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
  );
}

function WorkComposer({
  draft,
  setDraft,
  working,
  onSend,
  fileRef,
  cameraRef,
  note,
  onFiles,
  confirmPending = false,
}: {
  draft: string;
  setDraft: (value: string) => void;
  working: boolean;
  onSend: (text: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  cameraRef: React.RefObject<HTMLInputElement | null>;
  note: string | null;
  onFiles: (files: FileList) => void | Promise<void>;
  confirmPending?: boolean;
}) {
  const t = useT();
  const [dropping, setDropping] = useState(false);

  return (
    <div>
      {note ? (
        <p role="status" className="border-t px-4 py-2 text-[12.5px] text-muted-foreground">
          {note}
        </p>
      ) : null}
      <form
        className={cn(
          "flex items-center gap-2 border-t p-3 transition-colors",
          dropping && "bg-primary/5 ring-1 ring-primary/40 ring-inset",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onSend(draft);
        }}
      >
        <label htmlFor="composer" className="sr-only">
          {t("common.messageTheCompanion")}
        </label>
        <input
          ref={fileRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          disabled={working}
          onChange={(e) => {
            if (e.target.files) void onFiles(e.target.files);
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
            if (e.target.files) void onFiles(e.target.files);
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
          <Paperclip className="size-4" aria-hidden="true" />
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
          id="composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={working}
          placeholder={
            dropping
              ? t("work.dropHere")
              : working
                ? t("work.working")
                : confirmPending
                  ? t("work.answerOrType")
                  : t("work.askAnything")
          }
          className="min-w-0 flex-1 rounded-full border bg-background px-3.5 py-2.5 text-[14px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
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
      <p className="px-4 pb-3 text-center text-[11px] text-muted-foreground">
        {t("work.privacyNote")}{" "}
        <Link to="/privacy" className="underline-offset-2 hover:underline">
          {t("work.learnPrivacy")}
        </Link>
      </p>
    </div>
  );
}
