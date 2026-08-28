import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useT } from "@/app/i18n";
import { ArrowRight, Clapperboard, ExternalLink, FileText, Image, ListTodo, Loader2 } from "lucide-react";
import type { LifeContext, OnboardingJob } from "@alltheway/contracts";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ErrorState } from "@/app/async";
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
import { useAuth } from "@/auth/useAuth";
import { Meetings } from "@/app/Meetings";
import { cn } from "@/lib/utils";
import { VoiceControl } from "@/app/VoiceControl";
import { Digest } from "@/app/Digest";
import { LanguageOffer } from "@/app/LanguageChoice";
import { useCompanionThread } from "@/app/companion-thread";
import { DocumentPickup, askAboutAdded } from "@/app/Documents";
import { PlanStack } from "@/app/PlanStack";
import { BillingReturnBanner } from "@/app/Usage";

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
  const t = useT();
  const navigate = useNavigate();
  const { send, openCompanion } = useCompanionThread();
  const { state, reload } = useAsync(() => api.home());
  const [docsOpen, setDocsOpen] = useState(false);

  const job = state.status === "ready" ? state.data.onboarding.job : undefined;

  useEffect(() => {
    if (job !== "document") return;
    try {
      const key = "alltheway:doc-sheet";
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      setDocsOpen(true);
    } catch {
      setDocsOpen(true);
    }
  }, [job]);

  // Greeting and the four cards do not wait. First-run vs Today is a product
  // branch, not a reason to hide the shell behind onboarding then four more
  // round trips.
  if (state.status === "ready" && state.data.onboarding.job === null) {
    return <FirstRun onSaved={reload} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <HomeHeader />
      <BillingReturnBanner />
      <CapabilityGrid
        onImage={() => navigate("/app/studio?mode=image")}
        onVideo={() => navigate("/app/studio?mode=video")}
        onPlan={() => openCompanion()}
        onFile={() => setDocsOpen(true)}
      />

      {state.status === "loading" ? <HomeSkeleton /> : null}
      {state.status === "error" ? (
        <ErrorState message={state.message} onRetry={reload} />
      ) : null}
      {state.status === "ready" ? (
        <HomeRest
          job={state.data.onboarding.job ?? "skipped"}
          plan={state.data.plan}
          runs={state.data.runs}
          digest={state.data.digest}
          documents={state.data.documents}
          onAddFile={() => setDocsOpen(true)}
        />
      ) : null}

      <Sheet open={docsOpen} onOpenChange={setDocsOpen}>
        <SheetContent side="bottom" className="gap-4 p-4">
          <SheetHeader className="p-0">
            <SheetTitle>{t("today.addAFile")}</SheetTitle>
            <SheetDescription>{t("today.addAFileHint")}</SheetDescription>
          </SheetHeader>
          <DocumentPickup
            onUploaded={(name) => {
              reload();
              openCompanion();
              send(askAboutAdded(name));
              setDocsOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function HomeHeader() {
  const t = useT();
  const { user } = useAuth();
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

function HomeRest({
  job,
  plan,
  runs,
  digest,
  documents,
  onAddFile,
}: {
  job: OnboardingJob;
  plan: SessionDetail | null;
  runs: WatcherRun[];
  digest: DigestData;
  documents: UserDocument[];
  onAddFile: () => void;
}) {
  const t = useT();
  const firstWin = plan !== null || documents.length > 0;
  const indexing = documents.find((d) => d.status === "indexing" || d.status === "screening");

  return (
    <>
      <LanguageOffer show={firstWin} />
      <Digest digest={digest} />

      {indexing ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("today.indexing", { name: indexing.title })}
        </p>
      ) : null}

      {plan ? <ContinueCard plan={plan} /> : null}

      {job === "meetings" ? (
        <>
          <MeetingsJobCard />
          <Meetings />
        </>
      ) : null}

      {job === "document" ? (
        <section className="rounded-brand-lg border bg-card p-5 shadow-e1">
          <h2 className="text-[16px] font-semibold">{t("today.addAFile")}</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            {t("today.addAFileHint")}
          </p>
          <Button type="button" variant="brand" size="lg" className="mt-4" onClick={onAddFile}>
            {t("today.addAFile")}
          </Button>
        </section>
      ) : null}

      <Overnight runs={runs} />
    </>
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

      <div className="mt-4">
        <PlanStack steps={plan.plan} />
      </div>

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

function CapabilityGrid({
  onImage,
  onVideo,
  onPlan,
  onFile,
}: {
  onImage: () => void;
  onVideo: () => void;
  onPlan: () => void;
  onFile: () => void;
}) {
  const t = useT();
  const cards = [
    { key: "image", icon: Image, title: t("today.capabilityImage"), hint: t("today.capabilityImageHint"), onClick: onImage },
    { key: "video", icon: Clapperboard, title: t("today.capabilityVideo"), hint: t("today.capabilityVideoHint"), onClick: onVideo },
    { key: "plan", icon: ListTodo, title: t("today.capabilityPlan"), hint: t("today.capabilityPlanHint"), onClick: onPlan },
    { key: "file", icon: FileText, title: t("today.capabilityFile"), hint: t("today.capabilityFileHint"), onClick: onFile },
  ] as const;

  return (
    <section aria-labelledby="capability-heading">
      <h2 id="capability-heading" className="mb-3 text-[16px] font-semibold">
        {t("today.capabilityHeading")}
      </h2>
      <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((card) => (
          <li key={card.key}>
            <button
              type="button"
              onClick={card.onClick}
              className="flex h-full w-full flex-col items-start gap-2 rounded-brand-lg border bg-card px-4 py-4 text-left shadow-e1 transition-colors hover:border-primary/40"
            >
              <card.icon className="size-6 shrink-0" aria-hidden="true" />
              <span className="text-[16px] font-semibold leading-snug">{card.title}</span>
              <span className="text-[13.5px] leading-relaxed text-muted-foreground">{card.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MeetingsJobCard() {
  const t = useT();
  const { state, reload } = useAsync(() => api.connectors());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = state.status === "ready"
    ? {
        meet: state.data.connectors.find((c) => c.id === "google_meet"),
        calendar: state.data.connectors.find((c) => c.id === "google_calendar"),
      }
    : undefined;
  const connected = Boolean(google?.meet?.connected || google?.calendar?.connected);

  async function connect() {
    setStarting(true);
    setError(null);
    try {
      const target = google?.meet?.connected ? "google_calendar" : "google_meet";
      const { url } = await api.connectGoogle({ connector: target, drafts: false });
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

      {connected ? (
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
