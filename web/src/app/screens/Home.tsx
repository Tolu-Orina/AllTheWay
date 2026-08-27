import { useState } from "react";
import { Link } from "react-router";
import { useT } from "@/app/i18n";
import { ArrowRight, Check, ExternalLink, Loader2 } from "lucide-react";
import type { LifeContext, OnboardingJob } from "@alltheway/contracts";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { RUN_STATE_LABELS } from "@alltheway/contracts";

import {
  api,
  type Digest as DigestData,
  type SessionDetail,
  type UserDocument,
  type WatcherRun,
} from "@/app/data";
import { timeOfDay } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/utils";
import { VoiceControl } from "@/app/VoiceControl";
import { Digest, digestIsQuiet } from "@/app/Digest";
import { LanguageOffer } from "@/app/LanguageChoice";
import { CompanionConversation } from "@/app/CompanionPanel";
import { useCompanionThread } from "@/app/companion-thread";
import { DocumentPickup } from "@/app/Documents";

type HomeData = {
  plan: SessionDetail | null;
  runs: WatcherRun[];
  digest: DigestData;
  documents: UserDocument[];
};

type ActivationJob = Exclude<OnboardingJob, "skipped">;

const JOBS: ActivationJob[] = ["talk", "document", "meetings"];

function orderJobs(life: LifeContext | null): ActivationJob[] {
  if (life === "work") return ["document", "meetings", "talk"];
  if (life === "personal") return ["talk", "document", "meetings"];
  return JOBS;
}

function HomeSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-44 animate-pulse rounded-brand-lg bg-muted" />
      <div className="h-32 animate-pulse rounded-brand-lg bg-muted" />
    </div>
  );
}

export default function Home() {
  const { state, reload } = useAsync(() => api.onboarding());

  return (
    <Async state={state} reload={reload} skeleton={<HomeSkeleton />}>
      {(onboarding) =>
        onboarding.job === null ? (
          <FirstRun onSaved={reload} />
        ) : (
          <HomeToday job={onboarding.job} lifeContext={onboarding.lifeContext} />
        )
      }
    </Async>
  );
}

function FirstRun({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const { refreshOnboarding } = useCompanionThread();
  const [life, setLife] = useState<LifeContext | null>(null);
  const [saving, setSaving] = useState<OnboardingJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(job: OnboardingJob) {
    setSaving(job);
    setError(null);
    try {
      await api.setOnboarding({ job, lifeContext: life });
      refreshOnboarding();
      onSaved();
    } catch {
      setError(t("today.couldNotSave"));
      setSaving(null);
    }
  }

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]">
          {t("today.whatShouldWeStartWith")}
        </h1>
      </header>

      <div>
        <p className="text-[13px] text-muted-foreground">{t("today.lifeContext")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["work", "personal", "both"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={life === value}
              onClick={() => setLife((prev) => (prev === value ? null : value))}
              className={
                life === value
                  ? "rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-[13px]"
                  : "rounded-full border px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
              }
            >
              {t(`today.life${value[0].toUpperCase()}${value.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {orderJobs(life).map((job) => (
          <li key={job}>
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void choose(job)}
              className="flex w-full flex-col items-start gap-1 rounded-brand-lg border bg-card px-4 py-4 text-left shadow-e1 transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-[16px] font-semibold">
                {t(`today.job${job[0].toUpperCase()}${job.slice(1)}`)}
                {saving === job ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <span className="text-[13.5px] leading-relaxed text-muted-foreground">
                {t(`today.job${job[0].toUpperCase()}${job.slice(1)}Hint`)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={saving !== null}
        onClick={() => void choose("skipped")}
        className="self-start text-[13px] text-muted-foreground underline underline-offset-2 disabled:opacity-50"
      >
        {saving === "skipped" ? t("today.saving") : t("today.skipForNow")}
      </button>
    </div>
  );
}

function HomeToday({
  job,
  lifeContext,
}: {
  job: OnboardingJob;
  lifeContext: LifeContext | null;
}) {
  const t = useT();
  const { user } = useAuth();
  const { state, reload } = useAsync<HomeData>(async () => {
    const [plan, runs, digest, docs] = await Promise.all([
      api.homePlan(),
      api.watcherRuns(),
      api.digest(),
      api.documents().catch((err: unknown) => {
        // Optional status row. A local/dev gateway without the librarian
        // must not take Today down with it.
        if (err instanceof ApiError && (err.status === 503 || err.code === "not_configured")) {
          return { documents: [] };
        }
        throw err;
      }),
    ]);
    return { plan, runs, digest, documents: docs.documents };
  });

  const [docsOpen, setDocsOpen] = useState(() => {
    if (job !== "document") return false;
    try {
      const key = "alltheway:doc-sheet";
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
      return true;
    } catch {
      return true;
    }
  });
  const [showMeetings, setShowMeetings] = useState(job === "meetings");
  const [focusComposer, setFocusComposer] = useState(job === "talk");

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
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            {t("common.hereIsWhereThingsStand")}
          </p>
        </div>
        <VoiceControl />
      </header>

      <Async state={state} reload={reload} skeleton={<HomeSkeleton />}>
        {({ plan, runs, digest, documents }) => {
          const quiet = digestIsQuiet(digest);
          const firstWin = plan !== null || documents.length > 0;
          const indexing = documents.find(
            (d) => d.status === "indexing" || d.status === "screening",
          );

          return (
            <>
              <LanguageOffer show={firstWin} />

              <Digest digest={digest} />

              {indexing ? (
                <p role="status" className="text-[13px] text-muted-foreground">
                  {t("today.indexing", { name: indexing.title })}
                </p>
              ) : null}

              {plan && !quiet ? (
                <ContinueCard plan={plan} />
              ) : null}

              {quiet ? (
                <StarterChips
                  plan={plan}
                  life={lifeContext}
                  onTalk={() => setFocusComposer(true)}
                  onDocument={() => setDocsOpen(true)}
                  onMeetings={() => setShowMeetings(true)}
                />
              ) : null}

              {plan && quiet ? <ContinueCard plan={plan} /> : null}

              {showMeetings ? <MeetingsJobCard /> : null}

              {job === "document" ? (
                <section className="rounded-brand-lg border bg-card p-5 shadow-e1">
                  <h2 className="text-[16px] font-semibold">{t("today.addAFile")}</h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
                    {t("today.addAFileHint")}
                  </p>
                  <Button
                    type="button"
                    variant="brand"
                    size="lg"
                    className="mt-4"
                    onClick={() => setDocsOpen(true)}
                  >
                    {t("today.addAFile")}
                  </Button>
                </section>
              ) : null}

              <Overnight runs={runs} />

              <section
                aria-label={t("common.messageTheCompanion")}
                className="flex max-h-[min(24rem,50dvh)] flex-col overflow-hidden rounded-brand-lg border bg-card shadow-e1 lg:hidden"
              >
                <CompanionConversation autoFocus={focusComposer} />
              </section>
            </>
          );
        }}
      </Async>

      <Sheet open={docsOpen} onOpenChange={setDocsOpen}>
        <SheetContent side="bottom" className="gap-4 p-4">
          <SheetHeader className="p-0">
            <SheetTitle>{t("today.addAFile")}</SheetTitle>
            <SheetDescription>{t("today.addAFileHint")}</SheetDescription>
          </SheetHeader>
          <DocumentPickup onUploaded={reload} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ContinueCard({ plan }: { plan: SessionDetail }) {
  const t = useT();
  return (
    <section
      aria-labelledby="continue-heading"
      className="rounded-brand-lg border bg-card p-5 shadow-e1 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
            {t("common.inProgress")}
          </p>
          <h2 id="continue-heading" className="mt-1.5 text-[19px] font-semibold">
            {plan.title}
          </h2>
        </div>
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
          {plan.done} of {plan.total}
        </span>
      </div>

      <ul className="mt-4 space-y-2.5">
        {plan.plan.map((step) => (
          <li key={step.label} className="flex items-center gap-2.5 text-[14px]">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-[18px] shrink-0 place-items-center rounded-[6px] border",
                step.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background",
              )}
            >
              {step.done ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <span className={cn(step.done && "text-muted-foreground line-through")}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>

      <Button
        render={<Link to={`/app/work/${plan.id}`} />}
        variant="brand"
        size="lg"
        className="mt-5"
      >
        {t("common.continue")}
        <ArrowRight />
      </Button>
    </section>
  );
}

function StarterChips({
  plan,
  life,
  onTalk,
  onDocument,
  onMeetings,
}: {
  plan: SessionDetail | null;
  life: LifeContext | null;
  onTalk: () => void;
  onDocument: () => void;
  onMeetings: () => void;
}) {
  const t = useT();
  const actions: Record<ActivationJob, () => void> = {
    talk: onTalk,
    document: onDocument,
    meetings: onMeetings,
  };

  return (
    <div className="flex flex-wrap gap-2">
      {orderJobs(life).map((job) => (
        <button
          key={job}
          type="button"
          onClick={actions[job]}
          className="rounded-full border bg-card px-3.5 py-2 text-[13px] transition-colors hover:border-primary/40"
        >
          {t(`today.chip${job[0].toUpperCase()}${job.slice(1)}`)}
        </button>
      ))}
      {plan ? (
        <Link
          to={`/app/work/${plan.id}`}
          className="rounded-full border border-primary bg-primary/10 px-3.5 py-2 text-[13px]"
        >
          {t("common.continue")}
        </Link>
      ) : null}
    </div>
  );
}

function MeetingsJobCard() {
  const t = useT();
  const { state, reload } = useAsync(() => api.connectors());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = state.status === "ready"
    ? state.data.connectors.find((c) => c.provider === "google")
    : undefined;

  async function connect() {
    setStarting(true);
    setError(null);
    try {
      const { url } = await api.connectGoogle({ drafts: false });
      window.location.assign(url);
    } catch {
      setStarting(false);
      setError(t("today.couldNotSave"));
    }
  }

  return (
    <section className="rounded-brand-lg border bg-card p-5 shadow-e1">
      <h2 className="text-[16px] font-semibold">{t("today.meetingsTitle")}</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
        {t("today.meetingsListen")}
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
        {t("today.meetingsTranscript")}
      </p>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {t("today.connectGoogleHint")}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {google?.connected ? (
        <p className="mt-4 text-[13px]">{t("today.googleConnected")}</p>
      ) : (
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="mt-4"
          disabled={starting || state.status !== "ready"}
          onClick={() => void connect()}
        >
          {starting ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <ExternalLink className="size-4" />
          )}
          {starting ? t("today.connectingGoogle") : t("today.connectGoogle")}
        </Button>
      )}

      {state.status === "error" ? (
        <button
          type="button"
          onClick={reload}
          className="mt-3 text-[13px] text-muted-foreground underline underline-offset-2"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </section>
  );
}

function Overnight({ runs }: { runs: WatcherRun[] }) {
  const t = useT();
  return (
    <section aria-labelledby="watchers-heading">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="watchers-heading" className="text-[16px] font-semibold">
          {t("common.overnight")}
        </h2>
        <Link
          to="/app/watchers"
          className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("common.allWatchers")}
        </Link>
      </div>

      <ul className="divide-y overflow-hidden rounded-brand-lg border bg-card shadow-e1">
        {runs.map((w) => (
          <li key={w.id} className="flex items-center gap-3 p-4">
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {timeOfDay(w.at)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{w.name}</span>
              <span className="block truncate text-[13px] text-muted-foreground">
                {w.detail}
              </span>
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
  );
}
