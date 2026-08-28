import { useEffect, useRef, useState } from "react";
import { useT } from "@/app/i18n";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, Send } from "lucide-react";

import { LogoMark } from "@/components/primitives/logo";
import { Async, EmptyState } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { useTurn } from "@/app/use-turn";
import { useDecision } from "@/app/use-decision";
import { api, type SessionDetail as Detail } from "@/app/data";
import { SessionTranscript } from "@/app/VoiceTranscripts";
import { CitationChip } from "@/app/CitationChip";
import { ConfirmGate } from "@/app/ConfirmGate";
import { PlanStack } from "@/app/PlanStack";

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-56 animate-pulse rounded-brand-lg bg-muted" />
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0" />
      <div className="rounded-brand rounded-tl-sm border bg-card px-3.5 py-2.5 text-[14px] leading-relaxed shadow-e1">
        {children}
      </div>
    </div>
  );
}

export default function SessionDetailScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { state, reload } = useAsync<Detail | null>(() => api.session(id), [id]);
  const { turn, send } = useTurn(id);
  const { decide, reset: resetDecision, status: decisionStatus } = useDecision(id);
  const location = useLocation();
  const seedState = location.state as { seed?: string; promptOnly?: boolean } | null;
  const [draft, setDraft] = useState("");
  const hadTurn = useRef(false);
  const ended = useRef(false);

  useEffect(() => {
    hadTurn.current = false;
    ended.current = false;
    const sessionId = id;
    return () => {
      if (!sessionId || ended.current || !hadTurn.current) return;
      void api.endSession(sessionId).catch(() => {});
    };
  }, [id]);

  useEffect(() => {
    const seed = seedState?.seed?.trim();
    if (!id || !seed) return;
    const promptOnly = seedState?.promptOnly === true;
    navigate(".", { replace: true, state: null });
    if (promptOnly) {
      setDraft(seed);
      return;
    }
    hadTurn.current = true;
    void send(seed);
  }, [id, seedState?.seed, seedState?.promptOnly, send, navigate]);

  const working = turn.phase === "working";
  // Once a turn has produced steps they are the plan on screen. Before that the
  // stored plan stands, so the panel is never blank while one is being built.
  const showLive = turn.steps.length > 0;

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || working) return;
    hadTurn.current = true;
    setDraft("");
    resetDecision();
    void send(trimmed);
  };

  const doneForNow = () => {
    ended.current = true;
    void api.endSession(id).catch(() => {});
    navigate("/app/work");
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/app/work"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("nav.work")}
        </Link>
        <button
          type="button"
          onClick={doneForNow}
          className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("common.doneForNow")}
        </button>
      </div>

      <Async
        state={state}
        reload={reload}
        skeleton={<DetailSkeleton />}
        isEmpty={(d) => d === null}
        empty={
          <EmptyState
            title="That session is not here"
            body="It may have been deleted, or the link may be wrong. Your other sessions are unaffected."
          />
        }
      >
        {(session) => {
          if (!session) return null;
          const steps = showLive ? turn.steps : session.plan;
          return (
            <>
              <header>
                <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
                  {session.title}
                </h1>
                <p className="mt-1 text-[14px] text-muted-foreground">
                  {session.scope ? `${session.scope} · ` : null}
                  {session.done} of {session.total} done
                </p>
              </header>

              <section aria-label="Plan" className="rounded-brand-lg border bg-card p-5 shadow-e1">
                {working ? (
                  <p
                    className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground"
                    // The panel changes as steps land, so a screen reader is told
                    // to announce it rather than leaving the change silent.
                    aria-live="polite"
                  >
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    {turn.trace.at(-1) ?? "Working on it"}
                  </p>
                ) : null}

                <div
                  className="mt-1"
                  data-source={showLive ? "turn" : "session"}
                >
                  <PlanStack steps={steps} live={showLive} />
                </div>

                {turn.phase === "done" && turn.note ? (
                  <div className="mt-4 rounded-brand border bg-background px-3.5 py-2.5">
                    <p className="text-[13px] text-muted-foreground">{turn.note}</p>
                    {turn.citations.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {turn.citations.map((c) => (
                          <CitationChip key={c.chunkId} citation={c} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {session.correction ? (
                  <div className="mt-5 rounded-brand border bg-background p-4">
                    <p className="text-[13px] text-muted-foreground">What you changed</p>
                    <p className="mt-2 text-[14px] text-muted-foreground line-through decoration-destructive/60">
                      {session.correction.was}
                    </p>
                    <p className="mt-1.5 rounded-[6px] bg-accent px-2.5 py-1.5 text-[14px] font-medium text-accent-foreground">
                      {session.correction.now}
                    </p>
                  </div>
                ) : null}
              </section>

              {turn.trace.length > 0 ? (
                <details className="rounded-brand border bg-card px-4 py-3 text-[13px] shadow-e1">
                  <summary className="cursor-pointer text-muted-foreground select-none">
                    Why it did this ({turn.trace.length})
                  </summary>
                  <ul className="mt-2.5 space-y-1.5 text-muted-foreground">
                    {turn.trace.map((line, i) => (
                      <li key={`${line}-${i}`}>{line}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <section aria-label="Companion" className="flex flex-col gap-3">
                {session.companionNote ? <Bubble>{session.companionNote}</Bubble> : null}

                {turn.request ? (
                  <p className="ml-auto max-w-[26rem] rounded-brand rounded-tr-sm bg-accent px-3.5 py-2.5 text-[14px] leading-relaxed text-accent-foreground">
                    {turn.request}
                  </p>
                ) : null}

                {turn.phase === "clarify" ? (
                  <Bubble>
                    <p>{turn.question}</p>
                    {turn.options.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {turn.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => submit(option)}
                            className="rounded-full border px-3 py-1.5 text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </Bubble>
                ) : null}

                {turn.phase === "confirm" ? (
                  <ConfirmGate
                    summary={turn.summary}
                    actions={turn.actions}
                    confirmLabel={turn.options[0] ?? "Yes, go ahead"}
                    declineLabel={turn.options[1] ?? "No, stop"}
                    status={decisionStatus}
                    onConfirm={() => {
                      hadTurn.current = true;
                      void decide("confirmed", {
                        summary: turn.summary,
                        actions: turn.actions,
                      });
                    }}
                    onDecline={() => {
                      hadTurn.current = true;
                      void decide("declined", {
                        summary: turn.summary,
                        actions: turn.actions,
                      });
                    }}
                  />
                ) : null}

                {turn.phase === "error" ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-brand border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[14px]"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    <span>
                      {turn.error}{" "}
                      <button
                        type="button"
                        onClick={() => submit(turn.request)}
                        className="font-medium underline underline-offset-2"
                      >
                        {t("common.retry")}
                      </button>
                    </span>
                  </div>
                ) : null}
              </section>

              <form
                className="sticky bottom-24 flex items-center gap-2 rounded-full border bg-card p-1.5 shadow-e2 lg:bottom-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(draft);
                }}
              >
                <label htmlFor="composer" className="sr-only">
                  {t("common.messageTheCompanion")}
                </label>
                <input
                  id="composer"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={working}
                  placeholder={
                    working
                      ? "Working on it…"
                      : turn.phase === "confirm"
                        ? "Answer above, or type something else…"
                        : "Reply, or ask it to change something…"
                  }
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
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
        }}
      </Async>

      {/* The spoken record, next to what was decided rather than on a
          screen of its own — a transcript is evidence for a particular
          decision, and a list of recordings invites reading them as a
          corpus instead. Renders nothing when there is none. */}
      <SessionTranscript sessionId={id} />
    </div>
  );
}
