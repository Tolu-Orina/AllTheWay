import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowUp, Camera, Loader2, Mic, Paperclip } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ThreadAttachment, ThreadMessage, ActOutcome } from "@alltheway/contracts";
import { failureKindFrom } from "@alltheway/contracts";

import { CitationChip } from "@/app/CitationChip";
import { ChatStatus, ChatTurn, FilePills, GroundedIn, ProposedActionCard } from "@/app/ChatTurn";
import { ConfirmGate, pendingConfirmId } from "@/app/ConfirmGate";
import { PlanStack } from "@/app/PlanStack";
import { Recovery } from "@/app/Recovery";
import { SessionTranscript } from "@/app/VoiceTranscripts";
import { api, type SessionDetail } from "@/app/data";
import { useAsync } from "@/app/use-async";
import { useDecision } from "@/app/use-decision";
import { useTurn, type ProposedAction, type TurnPhase } from "@/app/use-turn";
import { useStartWork } from "@/app/use-start-work";
import { useVoice } from "@/app/use-voice";
import { useT } from "@/app/i18n";
import { composeSources, isComposeReview } from "@/app/compose-fields";
import { isPendingConfirmReply } from "@/lib/spoken-confirm";
import { DOCUMENT_ACCEPT, DOCUMENT_CAMERA_ACCEPT } from "@/lib/document-file";
import { Markdown } from "@/app/Markdown";
import { cn } from "@/lib/utils";
import {
  addStagedFiles,
  commitStaged,
  takeCommitted,
  type StageIssue,
  type StagedFile,
} from "@/lib/work-attach";

type ChatMessage = {
  id: number;
  role: "agent" | "user";
  text: string;
  at?: string;
  phase?: TurnPhase;
  options?: string[];
  actions?: ProposedAction[];
  citations?: ThreadMessage["citations"];
  steps?: ThreadMessage["steps"];
  attachments?: ThreadAttachment[];
};

function fromStored(thread: ThreadMessage[]): ChatMessage[] {
  const mapped: ChatMessage[] = thread.map((m, i) => ({
    id: i + 1,
    role: m.role,
    text: m.text,
    at: m.at,
    phase: m.phase,
    options: m.options,
    actions: m.actions,
    citations: m.citations,
    steps: m.steps,
    attachments: m.attachments,
  }));
  const last = mapped[mapped.length - 1];
  // A write plan that later stored as `done` still carries the calls Yes
  // must replay. Show the gate instead of a finished note.
  if (
    last?.role === "agent" &&
    last.actions?.length &&
    last.phase !== "clarify" &&
    last.phase !== "error" &&
    last.phase !== "done"
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

function stageNote(
  t: (key: string, vars?: Record<string, unknown>) => string,
  issue: StageIssue,
): string {
  if (issue.code === "tooMany") return t("work.tooManyFiles");
  if (issue.code === "tooLarge") return t("work.fileTooLarge", { name: issue.name });
  return t("work.fileEmpty", { name: issue.name });
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
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const busy = starting || attaching;

  const send = (text: string) => {
    const trimmed = text.trim() || (staged.length ? t("work.lookAtAttached") : "");
    if (!trimmed || busy) return;
    setDraft("");
    if (!staged.length) {
      void startWork({ seed: trimmed });
      return;
    }
    setAttaching(true);
    setNote(t("work.attaching"));
    void startWork({ seed: trimmed, files: staged })
      .catch((err) => {
        setNote((err as { message?: string }).message || t("work.attaching"));
        setAttaching(false);
      });
  };

  return (
    <section className="flex h-[calc(100dvh-11rem)] min-h-0 flex-1 flex-col bg-card lg:rounded-brand-lg lg:border lg:shadow-e1">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] text-navy-deep sm:text-[40px] dark:text-foreground">
          {t(greetingKey())}.
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          {t("work.getStarted")}
        </p>
      </div>
      <WorkComposer
        draft={draft}
        setDraft={setDraft}
        working={busy}
        onSend={send}
        fileRef={fileRef}
        cameraRef={cameraRef}
        note={note}
        staged={staged}
        onRemoveFile={(id) => setStaged((prev) => prev.filter((f) => f.id !== id))}
        onFiles={(files) => {
          const { next, issue } = addStagedFiles(staged, Array.from(files));
          setStaged(next);
          setNote(issue ? stageNote(t, issue) : null);
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
  const {
    decide,
    reset: resetDecision,
    status: decisionStatus,
    recorded,
    decision,
    did,
  } = useDecision(sessionId);
  const seedState = location.state as { seed?: string; promptOnly?: boolean } | null;
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [attaching, setAttaching] = useState(false);
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
  const working = turn.phase === "working" || attaching;

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
    const attachments = takeCommitted(sessionId);
    hadTurn.current = true;
    setHistory((prev) =>
      prev.some((m) => m.role === "user" && m.text === found.seed)
        ? prev
        : [
            ...prev,
            {
              id: prev.length + 1,
              role: "user",
              text: found.seed,
              at: new Date().toISOString(),
              attachments: attachments.length ? attachments : undefined,
            },
          ],
    );
    void runTurn(found.seed, attachments.length ? { attachments } : undefined);
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
          at: new Date().toISOString(),
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
      void (async () => {
        let trimmed = text.trim();
        const files = staged;
        if (!trimmed && files.length) trimmed = t("work.lookAtAttached");
        if (!trimmed) return;
        if (turn.phase === "working" || attaching) {
          pending.current.push(trimmed);
          return;
        }

        let attachments: ThreadAttachment[] | undefined;
        if (files.length) {
          setAttaching(true);
          setNote(t("work.attaching"));
          try {
            attachments = await commitStaged(sessionId, files);
            setStaged([]);
            setNote(null);
            onSettled?.();
          } catch (err) {
            setNote((err as { message?: string }).message || t("work.attaching"));
            setAttaching(false);
            return;
          }
          setAttaching(false);
        }

        const lastAgent =
          history.find((m) => m.id === pendingConfirmId(history)) ??
          [...history].reverse().find((m) => m.role === "agent");
        if (lastAgent?.actions?.length && isPendingConfirmReply(trimmed, lastAgent)) {
          hadTurn.current = true;
          setHistory((prev) => [
            ...prev,
            { id: prev.length + 1, role: "user", text: trimmed, at: new Date().toISOString(), attachments },
          ]);
          setDraft("");
          void decide("confirmed", { summary: lastAgent.text, actions: lastAgent.actions }).then(() =>
            onSettled?.(),
          );
          return;
        }
        hadTurn.current = true;
        setHistory((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            role: "user",
            text: trimmed,
            at: new Date().toISOString(),
            attachments,
          },
        ]);
        setDraft("");
        if (
          lastAgent?.actions?.some((a) => a.connector && a.tool) &&
          !isComposeReview(composeSources(lastAgent.steps, lastAgent.actions))
        ) {
          await decide("corrected", {
            summary: lastAgent.text,
            actions: lastAgent.actions ?? [],
            now: trimmed,
          });
          resetDecision();
          void runTurn(trimmed, attachments ? { attachments } : undefined);
          return;
        }
        resetDecision();
        void runTurn(trimmed, attachments ? { attachments } : undefined);
      })();
    },
    [staged, attaching, turn.phase, t, sessionId, history, decide, resetDecision, runTurn, onSettled],
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
    <section className="flex h-[calc(100dvh-11rem)] min-h-0 min-w-0 flex-1 flex-col bg-card lg:rounded-brand-lg lg:border lg:shadow-e1">
      <header className="px-6 pt-8 pb-4 sm:px-8">
        <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] text-navy-deep sm:text-[40px] dark:text-foreground">
          {t(greetingKey())}.
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{context}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-4 sm:px-8">
        {history.map((m, i) => (
          <ChatBubble
            key={m.id}
            message={m}
            previousAttachments={m.role === "agent" ? history[i - 1]?.attachments : undefined}
            confirming={m.id === confirmId}
            working={working}
            decisionStatus={decisionStatus}
            recorded={recorded}
            decision={decision}
            did={did}
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
          <div className="pl-11">
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
          <div className="pl-11">
            {turn.steps.length > 0 && !attaching ? (
              <div className="max-w-[36rem]">
                <PlanStack steps={turn.steps} live />
              </div>
            ) : (
              <ChatStatus className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {attaching ? t("work.attaching") : t("work.thinking")}
              </ChatStatus>
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
        staged={staged}
        onRemoveFile={(id) => setStaged((prev) => prev.filter((f) => f.id !== id))}
        confirmPending={
          (turn.phase === "confirm" || confirmId !== null) &&
          !(decision && recorded === "ok")
        }
        onFiles={(files) => {
          if (working) return;
          const { next, issue } = addStagedFiles(staged, Array.from(files));
          setStaged(next);
          setNote(issue ? stageNote(t, issue) : null);
        }}
      />
      <SessionTranscript sessionId={sessionId} />
    </section>
  );
}

function ChatBubble({
  message: m,
  previousAttachments,
  confirming,
  working,
  decisionStatus,
  recorded,
  decision,
  did,
  threadId,
  onSend,
  onConfirm,
  onDecline,
}: {
  message: ChatMessage;
  previousAttachments?: ThreadAttachment[];
  confirming: boolean;
  working: boolean;
  decisionStatus: string | null;
  recorded?: "pending" | "ok" | "failed";
  decision?: "confirmed" | "declined" | "corrected" | null;
  did?: ActOutcome[];
  threadId: string;
  onSend: (text: string) => void;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const reduced = useReducedMotion();
  const docs = m.citations?.filter((c) => c.kind !== "web") ?? [];
  const webs = m.citations?.filter((c) => c.kind === "web") ?? [];
  const extras = (
    <>
      {m.steps?.length && !confirming ? (
        <PlanStack
          steps={m.steps}
          onSend={
            working || m.actions?.length || isComposeReview(m.steps)
              ? undefined
              : onSend
          }
        />
      ) : null}
      {!confirming && m.actions?.length
        ? m.actions.map((a) => <ProposedActionCard key={a.label} action={a} />)
        : null}
      {confirming ? (
        <ConfirmGate
          summary={m.text}
          actions={m.actions ?? []}
          confirmLabel={m.options?.[0] ?? "Yes, go ahead"}
          declineLabel={m.options?.[1] ?? "No, stop"}
          busy={working || Boolean(decisionStatus)}
          status={decisionStatus}
          recorded={recorded}
          decision={decision}
          did={did}
          sessionId={threadId}
          steps={m.steps}
          onConfirm={onConfirm}
          onDecline={onDecline}
          onCorrect={(now) => onSend(now)}
        />
      ) : null}
      {m.phase === "error" ? (
        <Recovery
          kind={failureKindFrom(m.text)}
          message={m.text}
          turnId={`${threadId}-${m.id}`}
          onRetry={() => onSend(m.text)}
        />
      ) : null}
      {m.role === "agent" && !confirming && m.phase !== "error" ? (
        <GroundedIn citations={docs} attachments={previousAttachments} />
      ) : null}
      {webs.length ? (
        <div className="flex flex-wrap gap-1.5">
          {webs.map((c) => (
            <CitationChip key={c.chunkId} citation={c} />
          ))}
        </div>
      ) : null}
    </>
  );
  const hasExtras = Boolean(
    (m.steps?.length && !confirming) ||
      (!confirming && m.actions?.length) ||
      confirming ||
      m.phase === "error" ||
      docs.length ||
      webs.length ||
      (m.role === "agent" && previousAttachments?.length && !confirming),
  );

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      {confirming || m.phase === "error" ? (
        <ChatTurn side="agent" at={m.at} footer={extras}>
          {null}
        </ChatTurn>
      ) : (
        <ChatTurn
          side={m.role === "user" ? "user" : "agent"}
          at={m.at}
          footer={
            m.role === "user" && m.attachments?.length ? (
              <FilePills
                files={m.attachments.map((file, i) => ({
                  id: file.documentId || file.artifactId || `${file.name}-${i}`,
                  name: file.name,
                  mime: file.mime,
                }))}
              />
            ) : m.role === "agent" && hasExtras ? (
              extras
            ) : undefined
          }
        >
          {m.role === "agent" ? <Markdown className="md-compact">{m.text}</Markdown> : m.text}
        </ChatTurn>
      )}
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
  staged,
  onRemoveFile,
  confirmPending = false,
}: {
  draft: string;
  setDraft: (value: string) => void;
  working: boolean;
  onSend: (text: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  cameraRef: React.RefObject<HTMLInputElement | null>;
  note: string | null;
  onFiles: (files: FileList) => void;
  staged: StagedFile[];
  onRemoveFile: (id: string) => void;
  confirmPending?: boolean;
}) {
  const t = useT();
  const voice = useVoice();
  const [dropping, setDropping] = useState(false);
  const canSend = Boolean(draft.trim() || staged.length) && !working;

  return (
    <div className="px-6 pb-4 sm:px-8">
      {note ? (
        <p role="status" className="pb-2 text-[12.5px] text-muted-foreground">
          {note}
        </p>
      ) : null}
      <form
        className={cn(
          "rounded-brand-lg bg-muted px-4 pt-4 pb-3 transition-colors focus-within:ring-2 focus-within:ring-ring/40 dark:bg-accent",
          dropping && "ring-2 ring-navy-deep/30 ring-inset",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
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
          multiple
          className="sr-only"
          disabled={working}
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files);
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
            if (e.target.files) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          id="composer"
          rows={2}
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
                  : staged.length
                    ? t("work.askAboutAttached")
                    : t("work.askAnything")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(draft);
            }
          }}
          className="min-h-16 w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        {staged.length ? (
          <div className="mt-2">
            <FilePills
              files={staged.map((file) => ({ id: file.id, name: file.name, mime: file.mime }))}
              onRemove={working ? undefined : onRemoveFile}
              align="start"
            />
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-1">
          <button
            type="button"
            aria-label={t("documents.choose")}
            disabled={working}
            onClick={() => fileRef.current?.click()}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("documents.photograph")}
            disabled={working}
            onClick={() => cameraRef.current?.click()}
            className="hidden size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:grid"
          >
            <Camera className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("voice.startSession")}
            disabled={working}
            onClick={() => voice.start()}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground disabled:opacity-40"
          >
            <Mic className="size-4" aria-hidden="true" />
          </button>
          <span className="flex-1" />
          <button
            type="submit"
            aria-label={t("work.ask")}
            disabled={!canSend}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-navy-deep px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t("work.ask")}
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        </div>
      </form>
      <p className="mt-3 text-center font-mono text-[11px] text-muted-foreground">
        {t("work.privacyNote")}{" "}
        <Link to="/privacy" className="underline underline-offset-2">
          {t("work.learnPrivacy")}
        </Link>
      </p>
    </div>
  );
}
