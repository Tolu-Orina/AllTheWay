import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useReducedMotion } from "motion/react";
import { Loader2, PanelLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { useCompanionThread } from "@/app/companion-thread";
import { useSidebar } from "@/app/sidebar-state";
import { StudioLibrary, type LibraryFilter } from "@/app/studio/StudioLibrary";
import { api, type Artifact, type ArtifactDetail, type Usage } from "@/app/data";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";

type Mode = "image" | "video";
type Stage = "empty" | "generating" | "queued" | "rendering" | "joining" | "ready" | "error";

const STUDIO_SESSION = "studio";
const JOB_KEY = "alltheway.studioJob";
const MAX_VIDEO_SECONDS = 120;
const SHOT_MAX_SECONDS = 8;

type StoredJob = {
  jobId: string;
  prompt: string;
  seconds: number;
};

function nextPollDelay(previousMs: number): number {
  if (previousMs <= 0) return 8_000;
  return Math.min(20_000, Math.round(previousMs * 1.4));
}

function shotCountFor(seconds: number): number {
  return Math.max(1, Math.ceil(Math.min(MAX_VIDEO_SECONDS, seconds) / SHOT_MAX_SECONDS));
}

function meter(usage: Usage | undefined, name: Usage["meters"][number]["meter"]) {
  return usage?.meters.find((m) => m.meter === name);
}

function readStoredJob(): StoredJob | null {
  try {
    const raw = sessionStorage.getItem(JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredJob;
    if (parsed && typeof parsed.jobId === "string") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredJob(job: StoredJob | null) {
  try {
    if (!job) sessionStorage.removeItem(JOB_KEY);
    else sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
  } catch {
    /* ignore */
  }
}

export default function Studio() {
  const t = useT();
  const reduced = useReducedMotion();
  const { openCompanion } = useCompanionThread();
  const { collapsed, toggle } = useSidebar();
  const [params, setSearchParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "video" ? "video" : "image";
  const artifactParam = params.get("artifact");

  const usage = useAsync(() => api.usage());
  const prefs = useAsync(() => api.visualPreferences());
  const library = useAsync(() => api.artifacts(STUDIO_SESSION), []);

  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(6);
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("empty");
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [shotIndex, setShotIndex] = useState<number | null>(null);
  const [shotCount, setShotCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const resumed = useRef(false);

  const images = meter(usage.state.status === "ready" ? usage.state.data : undefined, "images");
  const draft = meter(usage.state.status === "ready" ? usage.state.data : undefined, "draft_video_seconds");
  const finals = meter(usage.state.status === "ready" ? usage.state.data : undefined, "final_video_seconds");
  const imagesLeft = images?.remaining ?? null;
  const draftLeft = draft?.remaining ?? null;
  const finalLeft = finals?.remaining ?? 0;
  const hasLook = prefs.state.status === "ready" && prefs.state.data.length > 0;
  const version = artifact?.versions.find((v) => v.n === (viewing ?? artifact.currentVersion));
  const assembledCount = useMemo(() => {
    const row = artifact?.provenance.sources.find((s) => /assembled from (\d+)/i.test(s));
    if (row) {
      const match = row.match(/assembled from (\d+)/i);
      return match ? Number(match[1]) : null;
    }
    return shotCount && shotCount > 1 ? shotCount : null;
  }, [artifact, shotCount]);

  const mediaItems = useMemo(() => {
    if (library.state.status !== "ready") return [];
    return library.state.data.filter((item) => item.kind === "image" || item.kind === "video");
  }, [library.state]);

  useEffect(() => {
    if (!artifact || !version) {
      setBlobUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }
    let live = true;
    let created: string | null = null;
    void api.artifactBytes(artifact.id, version.n).then((blob) => {
      if (!live) return;
      created = URL.createObjectURL(blob);
      setBlobUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return created;
      });
    });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [artifact, version?.n]);

  useEffect(() => {
    if (!artifactParam) return;
    if (artifact?.id === artifactParam) return;
    let live = true;
    void api
      .artifact(artifactParam)
      .then((detail) => {
        if (!live || !detail) return;
        if (detail.kind !== "image" && detail.kind !== "video") return;
        setArtifact(detail);
        setViewing(detail.currentVersion);
        setStage("ready");
        setError(null);
        const current = detail.versions.find((v) => v.n === detail.currentVersion);
        if (current?.prompt) setPrompt(current.prompt);
        if (detail.kind === "video" && params.get("mode") !== "video") {
          setSearchParams({ mode: "video", artifact: detail.id }, { replace: true });
        }
      })
      .catch(() => {
        /* missing id is an empty stage, not a crash */
      });
    return () => {
      live = false;
    };
  }, [artifactParam, artifact?.id, params, setSearchParams]);

  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const stored = readStoredJob();
    if (stored) {
      setJobId(stored.jobId);
      setPrompt(stored.prompt);
      setSeconds(stored.seconds);
      setStage("rendering");
      if (stored.seconds > SHOT_MAX_SECONDS) {
        setShotCount(shotCountFor(stored.seconds));
      }
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("mode", "video");
        return next;
      }, { replace: true });
      return;
    }
    void api.studioOpenJobs().then((jobs) => {
      const open = jobs[0];
      if (!open) return;
      setJobId(open.jobId);
      setPrompt(open.prompt);
      setSeconds(open.seconds);
      setStage(open.status);
      setShotIndex(open.shotIndex ?? null);
      setShotCount(open.shotCount ?? (open.seconds > SHOT_MAX_SECONDS ? shotCountFor(open.seconds) : null));
      writeStoredJob({ jobId: open.jobId, prompt: open.prompt, seconds: open.seconds });
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("mode", "video");
        return next;
      }, { replace: true });
    }).catch(() => {
      /* no open job is the common case */
    });
  }, [setSearchParams]);

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    let handle = 0;
    let delay = 0;
    async function tick() {
      if (!live) return;
      try {
        const result = await api.studioJob(jobId!);
        if (!live) return;
        if (typeof result.shotIndex === "number") setShotIndex(result.shotIndex);
        if (typeof result.shotCount === "number") setShotCount(result.shotCount);
        if (result.status === "ready" && result.artifact) {
          writeStoredJob(null);
          setJobId(null);
          setArtifact(result.artifact);
          setViewing(result.artifact.currentVersion);
          setStage("ready");
          setSearchParams({ mode: "video", artifact: result.artifact.id }, { replace: true });
          void library.reload();
          void usage.reload();
          return;
        }
        if (result.status === "failed" || result.status === "declined" || result.status === "quota") {
          writeStoredJob(null);
          setJobId(null);
          setStage("error");
          setError(
            result.status === "quota"
              ? result.message || t("studio.quotaVideoEmpty")
              : result.message || t("studio.jobLost"),
          );
          return;
        }
        if (
          result.status === "queued" ||
          result.status === "rendering" ||
          result.status === "joining"
        ) {
          setStage(result.status);
        }
      } catch {
        /* a missed poll is retried; the job is still running */
      }
      if (!live) return;
      delay = nextPollDelay(delay);
      handle = window.setTimeout(() => void tick(), delay);
    }
    void tick();
    return () => {
      live = false;
      window.clearTimeout(handle);
    };
  }, [jobId, library, usage, setSearchParams, t]);

  const quotaEmpty = mode === "image" && imagesLeft === 0;
  const quotaVideoEmpty =
    mode === "video" && draftLeft !== null && draftLeft < seconds;
  const busy =
    stage === "generating" ||
    stage === "queued" ||
    stage === "rendering" ||
    stage === "joining";
  const canGenerate =
    mode === "image" && prompt.trim().length > 0 && !busy && !quotaEmpty;
  const canDraft =
    mode === "video" && prompt.trim().length > 0 && !busy && !quotaVideoEmpty;

  function setMode(next: Mode) {
    const nextParams: Record<string, string> = { mode: next };
    if (artifactParam) nextParams.artifact = artifactParam;
    setSearchParams(nextParams, { replace: true });
  }

  function startNew() {
    setArtifact(null);
    setViewing(null);
    setStage("empty");
    setError(null);
    setJobId(null);
    setShotIndex(null);
    setShotCount(null);
    writeStoredJob(null);
    setSearchParams({ mode }, { replace: true });
  }

  function openFromLibrary(item: Artifact) {
    const nextMode: Mode = item.kind === "video" ? "video" : "image";
    setSearchParams({ mode: nextMode, artifact: item.id }, { replace: true });
  }

  async function generate() {
    if (!canGenerate && stage !== "error") return;
    if (!prompt.trim() || quotaEmpty) return;
    setStage("generating");
    setError(null);
    try {
      const result = await api.studioGenerate({
        prompt: prompt.trim(),
        mode: "image",
        artifactId: artifact?.id,
      });
      if (result.status === "ready" && result.artifact) {
        setArtifact(result.artifact);
        setViewing(result.artifact.currentVersion);
        setStage("ready");
        setSearchParams({ mode: "image", artifact: result.artifact.id }, { replace: true });
        void usage.reload();
        void library.reload();
        return;
      }
      setStage("error");
      if (result.status === "quota") setError(t("studio.quotaEmpty"));
      else if (result.status === "declined") setError(t("studio.declined"));
      else setError(result.message || t("studio.unreachable"));
    } catch (err) {
      setStage("error");
      setError(err instanceof ApiError ? err.message : t("studio.unreachable"));
    }
  }

  async function draftVideo() {
    if (!canDraft && stage !== "error") return;
    if (!prompt.trim() || quotaVideoEmpty) return;
    setStage("queued");
    setError(null);
    try {
      const result = await api.studioGenerate({
        prompt: prompt.trim(),
        mode: "video",
        seconds,
        artifactId: artifact?.kind === "video" ? artifact.id : undefined,
      });
      if (result.status === "quota") {
        setStage("error");
        setError(t("studio.quotaVideoEmpty"));
        return;
      }
      if (result.status === "declined") {
        setStage("error");
        setError(t("studio.declined"));
        return;
      }
      if ((result.status === "queued" || result.status === "rendering") && result.jobId) {
        setJobId(result.jobId);
        setStage(result.status);
        setShotCount(seconds > SHOT_MAX_SECONDS ? shotCountFor(seconds) : null);
        setShotIndex(0);
        writeStoredJob({ jobId: result.jobId, prompt: prompt.trim(), seconds });
        return;
      }
      if (result.status === "ready" && result.artifact) {
        setArtifact(result.artifact);
        setViewing(result.artifact.currentVersion);
        setStage("ready");
        void usage.reload();
        void library.reload();
        return;
      }
      setStage("error");
      setError(result.message || t("studio.jobLost"));
    } catch (err) {
      setStage("error");
      setError(err instanceof ApiError ? err.message : t("studio.jobLost"));
    }
  }

  const waiting = stage === "queued" || stage === "rendering" || stage === "joining";
  const frameLabel = useMemo(() => {
    if (stage === "generating") return t("studio.generating");
    if (stage === "joining") return t("studio.joining");
    if (waiting) return stage === "queued" ? t("studio.queued") : t("studio.rendering");
    if (stage === "error" && error) return error;
    if (stage === "ready") return prompt.trim() || t("studio.emptyFrame");
    return mode === "video" ? t("studio.emptyClip") : t("studio.emptyFrame");
  }, [error, mode, prompt, stage, t, waiting]);

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-4 lg:min-h-[calc(100dvh-5rem)]">
      <header className="flex flex-wrap items-center gap-3">
        {collapsed ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={t("nav.expand")}
            title={t("nav.expand")}
            className="hidden size-9 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:grid"
          >
            <PanelLeft className="size-[18px]" aria-hidden="true" />
          </button>
        ) : null}
        <h1 className="sr-only">{t("studio.title")}</h1>
        <div
          role="tablist"
          aria-label={t("studio.title")}
          className="flex items-center gap-0.5 rounded-full border bg-card p-0.5"
        >
          {(["image", "video"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] transition-colors",
                mode === value
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "image" ? t("studio.image") : t("studio.video")}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {mode === "image"
            ? imagesLeft === null
              ? null
              : t("studio.imagesLeft", { count: imagesLeft })
            : draftLeft === null
              ? null
              : t("studio.draftSecondsLeft", { count: draftLeft })}
        </p>
        <button
          type="button"
          onClick={() => openCompanion()}
          className="ml-auto text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("studio.askCompanion")}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <StudioLibrary
          items={mediaItems}
          filter={filter}
          onFilter={setFilter}
          selectedId={artifact?.id ?? null}
          onSelect={openFromLibrary}
          onNew={startNew}
        />

        <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-3">
          <section
            aria-label={frameLabel}
            aria-busy={busy}
            className="relative flex min-h-[18rem] flex-1 items-center justify-center overflow-hidden rounded-brand-lg bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] ring-1 ring-border/70 sm:min-h-[22rem]"
          >
            {blobUrl && version?.mimeType.startsWith("video/") ? (
              <video
                src={blobUrl}
                controls
                className="max-h-[min(70dvh,40rem)] w-full object-contain"
              />
            ) : blobUrl ? (
              <img
                src={blobUrl}
                alt={prompt.trim() || t("studio.emptyFrame")}
                className="max-h-[min(70dvh,40rem)] w-full object-contain"
              />
            ) : (
              <p className="max-w-sm px-6 text-center text-[14px] leading-relaxed text-muted-foreground">
                {mode === "video" ? t("studio.emptyClip") : t("studio.emptyFrame")}
              </p>
            )}

            {stage === "generating" || waiting ? (
              <div
                className={cn(
                  "absolute inset-0 grid place-items-center bg-background/55",
                  reduced ? "" : "supports-backdrop-filter:backdrop-blur-[2px]",
                )}
                role="status"
              >
                <p className="flex max-w-sm flex-col items-center gap-2 px-6 text-center text-[14px] text-foreground">
                  <span className="flex items-center gap-2">
                    {reduced ? null : <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {stage === "generating"
                      ? t("studio.generating")
                      : stage === "queued"
                        ? t("studio.queued")
                        : stage === "joining"
                          ? t("studio.joining")
                          : t("studio.rendering")}
                  </span>
                  {waiting && shotCount && shotCount > 1 && stage !== "joining" ? (
                    <span className="text-[12.5px] text-muted-foreground">
                      {t("studio.shotProgress", {
                        n: Math.min((shotIndex ?? 0) + 1, shotCount),
                        m: shotCount,
                      })}
                    </span>
                  ) : null}
                  {waiting ? (
                    <span className="text-[12.5px] text-muted-foreground">{t("studio.videoWait")}</span>
                  ) : null}
                </p>
              </div>
            ) : null}

            {stage === "error" && error ? (
              <div
                role="alert"
                className="absolute inset-0 grid place-items-center bg-background/70 px-6"
              >
                <div className="max-w-sm text-center">
                  <p className="text-[14px] leading-relaxed text-foreground">{error}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="mt-4 rounded-brand"
                    onClick={() => void (mode === "video" ? draftVideo() : generate())}
                    disabled={!prompt.trim() || (mode === "image" ? quotaEmpty : quotaVideoEmpty)}
                  >
                    {t("studio.retry")}
                  </Button>
                </div>
              </div>
            ) : null}

            {artifact && artifact.versions.length > 0 ? (
              <ul className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 px-3">
                {artifact.versions.map((v) => (
                  <li key={v.n}>
                    <button
                      type="button"
                      onClick={() => setViewing(v.n)}
                      className={cn(
                        "rounded-brand border bg-background/90 px-2.5 py-1 text-[12px] tabular-nums shadow-e1",
                        v.n === (viewing ?? artifact.currentVersion)
                          ? "border-primary/50 text-foreground"
                          : "text-muted-foreground hover:border-primary/30",
                      )}
                    >
                      {t("studio.version", { n: v.n })}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {artifact ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {assembledCount && assembledCount > 1 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  {t("studio.assembled", { count: assembledCount })}
                </p>
              ) : (
                <span />
              )}
              <Button render={<Link to={`/app/artifacts/${artifact.id}`} />} variant="outline" size="sm">
                {t("studio.openCanvas")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <form
        className="glass sticky bottom-24 z-10 flex flex-col gap-3 rounded-brand-lg p-3 shadow-e1 sm:p-4 lg:bottom-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "video") void draftVideo();
          else void generate();
        }}
      >
        <label className="sr-only" htmlFor="studio-prompt">
          {mode === "image" ? t("studio.placeholderImage") : t("studio.placeholderVideo")}
        </label>
        <textarea
          id="studio-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={mode === "image" ? t("studio.placeholderImage") : t("studio.placeholderVideo")}
          rows={2}
          className="w-full resize-none rounded-brand border bg-background px-3 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="flex flex-wrap items-center gap-3">
          {hasLook ? (
            <p className="text-[12.5px] text-muted-foreground">{t("studio.yourLook")}</p>
          ) : null}
          {mode === "video" ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                {t("studio.seconds")}
                <input
                  type="number"
                  min={1}
                  max={MAX_VIDEO_SECONDS}
                  value={seconds}
                  onChange={(event) =>
                    setSeconds(
                      Math.min(MAX_VIDEO_SECONDS, Math.max(1, Number(event.target.value) || 1)),
                    )
                  }
                  className="w-16 rounded-brand border bg-background px-2 py-1 text-[13px] tabular-nums outline-none"
                />
              </label>
              <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
                {seconds > SHOT_MAX_SECONDS
                  ? t("studio.shotCountPreview", { count: shotCountFor(seconds) })
                  : t("studio.shotHint")}
              </p>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {mode === "image" ? (
              <>
                {quotaEmpty ? (
                  <Button render={<Link to="/app/you" />} variant="outline" size="lg">
                    {t("studio.seePlans")}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  variant="brand"
                  size="lg"
                  className="rounded-brand"
                  disabled={!canGenerate}
                >
                  {stage === "generating" ? (
                    <>
                      {reduced ? null : <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      {t("studio.generating")}
                    </>
                  ) : artifact ? (
                    t("studio.generateAnother")
                  ) : (
                    t("studio.generate")
                  )}
                </Button>
              </>
            ) : (
              <VideoActions
                seconds={seconds}
                finalLeft={finalLeft}
                canDraft={canDraft}
                busy={busy}
                quotaEmpty={quotaVideoEmpty}
              />
            )}
          </div>
        </div>
        {quotaEmpty && mode === "image" ? (
          <p className="text-[13px] text-muted-foreground">{t("studio.quotaEmpty")}</p>
        ) : null}
        {quotaVideoEmpty && mode === "video" ? (
          <p className="text-[13px] text-muted-foreground">{t("studio.quotaVideoEmpty")}</p>
        ) : null}
      </form>
    </div>
  );
}

function VideoActions({
  seconds,
  finalLeft,
  canDraft,
  busy,
  quotaEmpty,
}: {
  seconds: number;
  finalLeft: number;
  canDraft: boolean;
  busy: boolean;
  quotaEmpty: boolean;
}) {
  const t = useT();
  const reduced = useReducedMotion();

  return (
    <div className="flex flex-col items-end gap-2">
      {finalLeft > 0 ? (
        <p className="max-w-sm text-right text-[12.5px] leading-relaxed text-muted-foreground">
          {t("studio.finalCost", { n: seconds, m: finalLeft })}
        </p>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{t("studio.finalOnMax")}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {quotaEmpty ? (
          <Button render={<Link to="/app/you" />} variant="outline" size="lg">
            {t("studio.seePlans")}
          </Button>
        ) : null}
        <Button type="submit" variant="brand" size="lg" className="rounded-brand" disabled={!canDraft}>
          {busy ? (
            <>
              {reduced ? null : <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("studio.rendering")}
            </>
          ) : (
            t("studio.draft")
          )}
        </Button>
        <Button type="button" variant="outline" size="lg" className="rounded-brand" disabled>
          {t("studio.renderFinal")}
        </Button>
      </div>
    </div>
  );
}
