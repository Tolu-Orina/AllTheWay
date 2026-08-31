import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useT } from "@/app/i18n";
import { Pause, Play, Plus, ShieldAlert } from "lucide-react";

import { Async, EmptyState } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { Button } from "@/components/ui/button";
import { ConfirmGate } from "@/app/ConfirmGate";
import { CEILING_LABELS } from "@alltheway/contracts";

import { api, type Watcher, type WatcherRun } from "@/app/data";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Draft = {
  instruction: string;
  name: string;
  trigger: "daily" | "hourly" | "session_ended" | "document_indexed";
};

const emptyDraft: Draft = {
  instruction: "",
  name: "",
  trigger: "daily",
};

function clipName(instruction: string): string {
  const clipped = instruction.trim().replace(/\s+/g, " ");
  if (clipped.length <= 48) return clipped;
  return `${clipped.slice(0, 45).trimEnd()}…`;
}

function triggerBody(draft: Draft): {
  triggerKind: "schedule" | "session_ended" | "document_indexed";
  intervalMinutes?: number;
} {
  if (draft.trigger === "session_ended") return { triggerKind: "session_ended" };
  if (draft.trigger === "document_indexed") return { triggerKind: "document_indexed" };
  return {
    triggerKind: "schedule",
    intervalMinutes: draft.trigger === "hourly" ? 60 : 1440,
  };
}

export default function Watchers() {
  const t = useT();
  const { state, reload } = useAsync<Watcher[]>(() => api.watchers());
  const runs = useAsync<WatcherRun[]>(() => api.watcherRuns());

  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [step, setStep] = useState<"list" | "compose" | "confirm">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);

  const sessionByWatcher = useMemo(() => {
    const map: Record<string, string> = {};
    if (runs.state.status !== "ready") return map;
    for (const run of runs.state.data) {
      if (run.sessionId && !map[run.watcherId]) map[run.watcherId] = run.sessionId;
    }
    return map;
  }, [runs.state]);

  function openCreate() {
    setFailure(null);
    setDraft(emptyDraft);
    setStep("compose");
  }

  function propose() {
    const instruction = draft.instruction.trim();
    if (!instruction) return;
    setDraft((prev) => ({
      ...prev,
      instruction,
      name: prev.name.trim() || clipName(instruction),
    }));
    setStep("confirm");
  }

  async function confirmCreate() {
    setCreating(true);
    setFailure(null);
    try {
      await api.createWatcher({
        name: draft.name.trim() || clipName(draft.instruction),
        instruction: draft.instruction.trim(),
        ceiling: "send_after_review",
        ...triggerBody(draft),
      });
      setStep("list");
      setDraft(emptyDraft);
      reload();
    } catch {
      setFailure(t("watchers.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function toggle(id: string, running: boolean) {
    setFailure(null);
    setPaused((prev) => ({ ...prev, [id]: running }));
    try {
      await api.setWatcherRunning(id, !running);
    } catch {
      setPaused((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFailure("We could not change that watcher. It is unchanged — try again.");
    }
  }

  const triggerLabel =
    draft.trigger === "hourly"
      ? t("watchers.triggerHourly")
      : draft.trigger === "session_ended"
        ? t("watchers.triggerSessionEnded")
        : draft.trigger === "document_indexed"
          ? t("watchers.triggerDocumentIndexed")
          : t("watchers.triggerDaily");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
            {t("nav.watchers")}
          </h1>
          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
            {t("watchers.empty")}
          </p>
        </div>
        {step === "list" ? (
          <Button variant="brand" size="lg" className="shrink-0" onClick={openCreate}>
            <Plus />
            {t("watchers.create")}
          </Button>
        ) : null}
      </header>

      {failure ? (
        <p
          role="alert"
          className="rounded-brand border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive"
        >
          {failure}
        </p>
      ) : null}

      {step === "compose" ? (
        <form
          className="flex flex-col gap-4 rounded-brand-lg border bg-card p-4 shadow-e1 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            propose();
          }}
        >
          <div>
            <label htmlFor="watcher-instruction" className="text-[14px] font-medium">
              {t("watchers.instructionLabel")}
            </label>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("watchers.cannotWatchInbox")}
            </p>
            <textarea
              id="watcher-instruction"
              required
              maxLength={2000}
              rows={4}
              value={draft.instruction}
              onChange={(e) => setDraft((prev) => ({ ...prev, instruction: e.target.value }))}
              placeholder={t("watchers.instructionPlaceholder")}
              className="mt-3 w-full resize-y rounded-brand border bg-background px-3 py-2 text-[14px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <fieldset>
            <legend className="text-[14px] font-medium">{t("watchers.triggerLabel")}</legend>
            <div className="mt-2 flex flex-col gap-2">
              {(
                [
                  ["daily", t("watchers.triggerDaily")],
                  ["hourly", t("watchers.triggerHourly")],
                  ["session_ended", t("watchers.triggerSessionEnded")],
                  ["document_indexed", t("watchers.triggerDocumentIndexed")],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-[14px]">
                  <input
                    type="radio"
                    name="watcher-trigger"
                    value={value}
                    checked={draft.trigger === value}
                    onChange={() => setDraft((prev) => ({ ...prev, trigger: value }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="brand" size="lg" disabled={!draft.instruction.trim()}>
              {t("common.continue")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setStep("list");
                setDraft(emptyDraft);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      {step === "confirm" ? (
        <div className="flex flex-col gap-3">
          <label htmlFor="watcher-name" className="text-[14px] font-medium">
            {t("watchers.nameLabel")}
          </label>
          <input
            id="watcher-name"
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full rounded-brand border bg-background px-3 py-2 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <ConfirmGate
            summary={t("watchers.confirmSummary", { name: draft.name, trigger: triggerLabel })}
            actions={[
              {
                label: CEILING_LABELS.send_after_review,
                reason: t("watchers.confirmReason"),
              },
            ]}
            dialogLabel="Confirm before creating"
            confirmLabel={creating ? t("watchers.creating") : t("watchers.confirm")}
            declineLabel={t("watchers.decline")}
            busy={creating}
            onConfirm={() => void confirmCreate()}
            onDecline={() => setStep("compose")}
          />
        </div>
      ) : null}

      {step === "list" ? (
        <Async
          state={state}
          reload={reload}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState
              title={t("watchers.create")}
              body={t("watchers.empty")}
              action={
                <Button variant="brand" size="lg" onClick={openCreate}>
                  <Plus />
                  {t("watchers.create")}
                </Button>
              }
            />
          }
        >
          {(data) => (
            <ul className="flex flex-col gap-3">
              {data
                .map((w) =>
                  paused[w.id] === undefined
                    ? w
                    : {
                        ...w,
                        running: !paused[w.id],
                      },
                )
                .map((w) => (
                  <li
                    key={w.id}
                    className="rounded-brand-lg border bg-card p-4 shadow-e1 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="text-[16px] font-semibold">{w.name}</h2>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          {w.trigger}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(w.id, w.running)}
                        aria-label={
                          w.running ? `Pause ${w.name}` : `Resume ${w.name}`
                        }
                        aria-pressed={!w.running}
                        className="grid size-9 shrink-0 place-items-center rounded-full border transition-colors hover:bg-muted"
                      >
                        {w.running ? (
                          <Pause className="size-4" aria-hidden="true" />
                        ) : (
                          <Play className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                          w.running
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-1.5 rounded-full",
                            w.running ? "bg-blue" : "bg-ink-faint",
                          )}
                        />
                        {w.running ? t("watchers.running") : t("watchers.paused")}
                      </span>

                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
                        <ShieldAlert className="size-3.5" aria-hidden="true" />
                        {CEILING_LABELS[w.ceiling]}
                      </span>

                      {sessionByWatcher[w.id] ? (
                        <Link
                          to={`/app/work/${sessionByWatcher[w.id]}`}
                          className="text-foreground underline-offset-2 hover:underline"
                        >
                          {t("watchers.openLastRun")}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          {w.lastRunAt ? relativeTime(w.lastRunAt) : t("watchers.neverRun")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Async>
      ) : null}

      <p className="rounded-brand border bg-muted/50 p-4 text-[13px] leading-relaxed text-muted-foreground">
        {t("common.irreversibleActionsExternalSendsPa")}
      </p>
    </div>
  );
}
