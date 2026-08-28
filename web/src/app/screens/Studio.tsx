import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { useCompanionThread } from "@/app/companion-thread";
import { api, type ArtifactDetail, type Usage } from "@/app/data";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";

type Mode = "image" | "video";
type Stage = "empty" | "generating" | "ready" | "error";

function meter(usage: Usage | undefined, name: Usage["meters"][number]["meter"]) {
  return usage?.meters.find((m) => m.meter === name);
}

export default function Studio() {
  const t = useT();
  const reduced = useReducedMotion();
  const { openCompanion } = useCompanionThread();
  const [params, setSearchParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "video" ? "video" : "image";

  const usage = useAsync(() => api.usage());
  const prefs = useAsync(() => api.visualPreferences());

  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(6);
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("empty");
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const images = meter(usage.state.status === "ready" ? usage.state.data : undefined, "images");
  const draft = meter(usage.state.status === "ready" ? usage.state.data : undefined, "draft_video_seconds");
  const finals = meter(usage.state.status === "ready" ? usage.state.data : undefined, "final_video_seconds");
  const imagesLeft = images?.remaining ?? null;
  const draftLeft = draft?.remaining ?? 0;
  const finalLeft = finals?.remaining ?? 0;
  const hasLook = prefs.state.status === "ready" && prefs.state.data.length > 0;
  const version = artifact?.versions.find((v) => v.n === (viewing ?? artifact.currentVersion));

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

  const quotaEmpty = mode === "image" && imagesLeft === 0;
  const canGenerate =
    mode === "image" && prompt.trim().length > 0 && stage !== "generating" && !quotaEmpty;

  function setMode(next: Mode) {
    setSearchParams({ mode: next }, { replace: true });
  }

  function startNew() {
    setArtifact(null);
    setViewing(null);
    setStage("empty");
    setError(null);
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
        void usage.reload();
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

  const frameLabel = useMemo(() => {
    if (stage === "generating") return t("studio.generating");
    if (stage === "error" && error) return error;
    if (stage === "ready") return prompt.trim() || t("studio.emptyFrame");
    return t("studio.emptyFrame");
  }, [error, prompt, stage, t]);

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-4 lg:min-h-[calc(100dvh-6rem)]">
      <header className="flex flex-wrap items-center gap-3">
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

      <section
        aria-label={frameLabel}
        aria-busy={stage === "generating"}
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
            {t("studio.emptyFrame")}
          </p>
        )}

        {stage === "generating" ? (
          <div
            className={cn(
              "absolute inset-0 grid place-items-center bg-background/55",
              reduced ? "" : "supports-backdrop-filter:backdrop-blur-[2px]",
            )}
            role="status"
          >
            <p className="flex items-center gap-2 text-[14px] text-foreground">
              {reduced ? null : <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("studio.generating")}
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
                onClick={() => void generate()}
                disabled={!prompt.trim() || quotaEmpty}
              >
                {t("studio.retry")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {artifact && artifact.versions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {artifact.versions.map((v) => (
              <li key={v.n}>
                <button
                  type="button"
                  onClick={() => setViewing(v.n)}
                  className={cn(
                    "rounded-brand border px-2.5 py-1 text-[12px] tabular-nums",
                    v.n === (viewing ?? artifact.currentVersion)
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:border-primary/30",
                  )}
                >
                  {t("studio.version", { n: v.n })}
                </button>
              </li>
            ))}
          </ul>
          <Button render={<Link to={`/app/artifacts/${artifact.id}`} />} variant="outline" size="sm">
            {t("studio.openCanvas")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={startNew}>
            {t("studio.newStill")}
          </Button>
        </div>
      ) : null}

      <form
        className="sticky bottom-24 z-10 flex flex-col gap-3 rounded-brand-lg border bg-card/90 p-3 shadow-e1 sm:p-4 lg:bottom-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "image") void generate();
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
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              {t("studio.seconds")}
              <input
                type="number"
                min={1}
                max={8}
                value={seconds}
                onChange={(event) =>
                  setSeconds(Math.min(8, Math.max(1, Number(event.target.value) || 1)))
                }
                className="w-14 rounded-brand border bg-background px-2 py-1 text-[13px] tabular-nums outline-none"
              />
            </label>
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
              <VideoActions seconds={seconds} draftLeft={draftLeft} finalLeft={finalLeft} />
            )}
          </div>
        </div>
        {quotaEmpty && mode === "image" ? (
          <p className="text-[13px] text-muted-foreground">{t("studio.quotaEmpty")}</p>
        ) : null}
      </form>
    </div>
  );
}

function VideoActions({
  seconds,
  draftLeft,
  finalLeft,
}: {
  seconds: number;
  draftLeft: number;
  finalLeft: number;
}) {
  const t = useT();

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="max-w-sm text-right text-[12.5px] leading-relaxed text-muted-foreground">
        {draftLeft === 0
          ? t("studio.draftSecondsLeft", { count: 0 })
          : t("studio.videoWait")}
      </p>
      {finalLeft > 0 ? (
        <p className="max-w-sm text-right text-[12.5px] leading-relaxed text-muted-foreground">
          {t("studio.finalCost", { n: seconds, m: finalLeft })}
        </p>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{t("studio.finalOnMax")}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="brand" size="lg" className="rounded-brand" disabled>
          {t("studio.draft")}
        </Button>
        <Button type="button" variant="outline" size="lg" className="rounded-brand" disabled>
          {t("studio.renderFinal")}
        </Button>
      </div>
    </div>
  );
}
