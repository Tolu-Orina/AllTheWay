import { useState } from "react";
import { Link, useParams } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowLeft, Check, Send, ShieldAlert } from "lucide-react";

import { LogoMark } from "@/components/primitives/logo";
import { Async, EmptyState } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { useTurn } from "@/app/use-turn";
import { api, type SessionDetail as Detail } from "@/app/data";
import { cn } from "@/lib/utils";

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-56 animate-pulse rounded-brand-lg bg-muted" />
    </div>
  );
}

/**
 * One plan line.
 *
 * The entrance animates on mount, deliberately not on scroll into view: a
 * viewport-gated reveal leaves a step invisible when it arrives below the fold
 * or when reduced-motion is on, which is precisely the bug that made the
 * landing page's cards disappear.
 */
/**
 * What a step would do outside the conversation, in the user's words.
 *
 * Shown on the step itself rather than only in the confirmation, so the
 * consequence is visible while the plan is still being read — not first
 * mentioned at the moment someone is being asked to approve it.
 */
const ACTION_LABEL: Record<string, string> = {
  send_external: "sends",
  make_payment: "pays",
  delete_data: "deletes",
  create_task: "creates a task",
  update_record: "changes a record",
};

function ActionBadge({ action }: { action: string }) {
  const label = ACTION_LABEL[action];
  if (!label) return null;
  const severe = action === "send_external" || action === "make_payment" || action === "delete_data";
  return (
    <span
      className={cn(
        "ml-1.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        severe
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function PlanRow({
  step,
  live,
}: {
  step: { label: string; done: boolean; action?: string };
  live: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.li
      initial={live ? { opacity: 0, y: reduced ? 0 : 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
      className="flex items-center gap-2.5 text-[14px]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded-[6px] border",
          step.done ? "border-primary bg-primary text-primary-foreground" : "bg-background",
        )}
      >
        {step.done ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className={cn(step.done && "text-muted-foreground line-through")}>{step.label}</span>
      {step.action ? <ActionBadge action={step.action} /> : null}
    </motion.li>
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
  const { id = "" } = useParams();
  const { state, reload } = useAsync<Detail | null>(() => api.session(id), [id]);
  const { turn, send } = useTurn(id);
  const [draft, setDraft] = useState("");

  const working = turn.phase === "working";
  // Once a turn has produced steps they are the plan on screen. Before that the
  // stored plan stands, so the panel is never blank while one is being built.
  const showLive = turn.steps.length > 0;

  const [decision, setDecision] = useState<"confirmed" | "declined" | null>(null);
  const [recorded, setRecorded] = useState<"pending" | "ok" | "failed">("pending");

  /**
   * Records what the user actually chose (FR-V5).
   *
   * The decision is shown immediately — the buttons must resolve under the
   * finger — but the word "recorded" waits for the write to land. Saying
   * "recorded" while the request is still in flight is a small lie that becomes
   * a large one exactly when the network fails, which is when a user most needs
   * to know their refusal did not stick.
   */
  const decide = async (kind: "confirmed" | "declined") => {
    setDecision(kind);
    setRecorded("pending");
    try {
      await api.recordDecision(id, {
        kind,
        summary: turn.summary,
        actions: turn.actions,
        modality: "text",
      });
      setRecorded("ok");
    } catch {
      setRecorded("failed");
    }
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || working) return;
    setDraft("");
    setDecision(null);
    setRecorded("pending");
    void send(trimmed);
  };

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/app/sessions"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Sessions
      </Link>

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
                  {session.scope} · {session.done} of {session.total} done
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

                <ul
                  className="space-y-2.5"
                  // Says whether these steps came from this turn or from the
                  // stored session. Visible in the DOM because "the panel filled
                  // in" is otherwise indistinguishable from "the panel already
                  // had four rows" — which is exactly how the first version of
                  // the streaming test passed while measuring nothing.
                  data-source={showLive ? "turn" : "session"}
                >
                  {steps.map((step, i) => (
                    <PlanRow key={`${step.label}-${i}`} step={step} live={showLive} />
                  ))}
                </ul>

                {turn.phase === "done" && turn.note ? (
                  <p className="mt-4 rounded-brand border bg-background px-3.5 py-2.5 text-[13px] text-muted-foreground">
                    {turn.note}
                  </p>
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
                <Bubble>{session.companionNote}</Bubble>

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
                  <div
                    // A live region, because the whole point is that a person
                    // notices before agreeing. A screen reader user must not
                    // have to go looking for the thing they are approving.
                    role="alertdialog"
                    aria-label="Confirm before acting"
                    aria-live="assertive"
                    className="rounded-brand border-2 border-destructive/40 bg-destructive/5 p-4"
                  >
                    <div className="flex gap-2.5">
                      <ShieldAlert
                        className="mt-0.5 size-5 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-[14px] leading-relaxed font-medium">{turn.summary}</p>

                        {turn.actions.length > 0 ? (
                          <ul className="mt-2.5 space-y-1.5">
                            {turn.actions.map((a) => (
                              <li key={a.label} className="text-[13px] text-muted-foreground">
                                <span className="text-foreground">{a.label}</span>
                                {" — "}
                                {a.reason}
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        <div className="mt-3.5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void decide("confirmed")}
                            className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground"
                          >
                            {turn.options[0] ?? "Yes, go ahead"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void decide("declined")}
                            className="rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            {turn.options[1] ?? "No, stop"}
                          </button>
                        </div>

                        {decision ? (
                          <p role="status" className="mt-2.5 text-[13px] text-muted-foreground">
                            {recorded === "pending"
                              ? decision === "confirmed"
                                ? "Saving your answer…"
                                : "Nothing was done. Saving your answer…"
                              : recorded === "failed"
                                ? `Nothing was done, but your answer could not be saved. ${
                                    decision === "confirmed" ? "Nothing ran." : ""
                                  }`
                                : decision === "confirmed"
                                  ? "Recorded. Nothing has run yet — connectors arrive in the next phase."
                                  : "Declined and recorded. Nothing was done."}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
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
                        Try again
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
                  Message the companion
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
    </div>
  );
}
