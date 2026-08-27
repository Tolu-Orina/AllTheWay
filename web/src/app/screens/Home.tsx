import { Link } from "react-router";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { RUN_STATE_LABELS } from "@alltheway/contracts";

import { api, type SessionDetail, type WatcherRun } from "@/app/data";
import { timeOfDay } from "@/lib/format";
import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/utils";
import { VoiceControl } from "@/app/VoiceControl";
import { Digest } from "@/app/Digest";
import { LanguageOffer } from "@/app/LanguageChoice";

const TRACE = [
  "Clarify gate asked about scope before drafting",
  "Preference learned: collapse navigation rather than extend it",
  "Calendar connector used with read + write, this workspace only",
];

type HomeData = { plan: SessionDetail | null; runs: WatcherRun[] };

function HomeSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-44 animate-pulse rounded-brand-lg bg-muted" />
      <div className="h-32 animate-pulse rounded-brand-lg bg-muted" />
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { state, reload } = useAsync<HomeData>(async () => {
    const [plan, runs] = await Promise.all([api.homePlan(), api.watcherRuns()]);
    return { plan, runs };
  });

  // Was "Tuesday, 24 August" and "Good morning, Jordan", both hardcoded — a
  // fixed date that was wrong the next morning, and a stub name shown to a real
  // signed-in user. The greeting follows the clock; the name follows the token.
  const now = new Date();
  const today = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.displayName?.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">{today}</p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          {/*
            This line used to read "Two watchers ran overnight. One is waiting
            on you." — hardcoded, and shown to every user whatever had actually
            happened. A front page that states a specific false fact is worse
            than one that states nothing, and it is the exact failure the digest
            below exists to fix: real counts, from the ledger, or silence.
          */}
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Here is where things stand.
          </p>
        </div>

        {/* Voice sits beside the greeting: it starts a conversation, so it
            belongs with the thing that greets you, not in the app chrome.
            Slate rather than the accent — orange is reserved for the one
            primary action on a screen, and Continue already holds it. */}
        <VoiceControl />
      </header>

      {/* Above the fold and above everything else on the screen: the two
          things that need a person come first, because on a phone at 07:40
          nothing below them will be read. */}
      <LanguageOffer />

      <Digest />

      <Async state={state} reload={reload} skeleton={<HomeSkeleton />}>
        {({ plan, runs }) => (
          <>
            {plan ? (
            <section
              aria-labelledby="continue-heading"
              className="rounded-brand-lg border bg-card p-5 shadow-e1 sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
                    In progress
                  </p>
                  <h2
                    id="continue-heading"
                    className="mt-1.5 text-[19px] font-semibold"
                  >
                    {plan.title}
                  </h2>
                </div>
                <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                  {plan.done} of {plan.total}
                </span>
              </div>

              <ul className="mt-4 space-y-2.5">
                {plan.plan.map((step) => (
                  <li
                    key={step.label}
                    className="flex items-center gap-2.5 text-[14px]"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-[18px] shrink-0 place-items-center rounded-[6px] border",
                        step.done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background",
                      )}
                    >
                      {step.done ? (
                        <Check className="size-3" strokeWidth={3} />
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        step.done && "text-muted-foreground line-through",
                      )}
                    >
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                render={<Link to={`/app/sessions/${plan.id}`} />}
                variant="brand"
                size="lg"
                className="mt-5"
              >
                Continue
                <ArrowRight />
              </Button>
            </section>

            ) : null}

            <section aria-labelledby="watchers-heading">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 id="watchers-heading" className="text-[16px] font-semibold">
                  Overnight
                </h2>
                <Link
                  to="/app/watchers"
                  className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  All watchers
                </Link>
              </div>

              <ul className="divide-y overflow-hidden rounded-brand-lg border bg-card shadow-e1">
                {runs.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 p-4">
                    <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                      {timeOfDay(w.at)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">
                        {w.name}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {w.detail}
                      </span>
                      {/* A block nobody can see is nearly as good as no block,
                          so a stopped run says what stopped it right here
                          rather than only in a detail view nobody opens. */}
                      {w.state === "blocked" && w.trace.length > 0 ? (
                        <span className="mt-1 block text-[12px] text-destructive">
                          {w.trace.find((line) => line.startsWith("Screening")) ?? w.trace[0]}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium",
                        w.state === "done"
                          ? "bg-accent text-accent-foreground"
                          : w.state === "blocked"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-primary/20 text-foreground",
                      )}
                    >
                      {RUN_STATE_LABELS[w.state]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </Async>

      <section
        aria-labelledby="trace-heading"
        className="rounded-brand-lg border bg-card p-5 shadow-e1"
      >
        <h2
          id="trace-heading"
          className="flex items-center gap-2 text-[16px] font-semibold"
        >
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Transparent trace
        </h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
          {TRACE.map((t) => (
            <li key={t} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-blue"
              />
              {t}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
