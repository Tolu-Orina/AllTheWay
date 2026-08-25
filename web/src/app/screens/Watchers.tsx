import { useState } from "react";
import { Pause, Play, ShieldAlert } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { CEILING_LABELS } from "@alltheway/contracts";

import { api, type Watcher } from "@/app/data";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Watchers() {
  const { state, reload } = useAsync<Watcher[]>(() => api.watchers());

  // Local overrides only, merged during render. Mirroring the whole list into
  // state via an effect would cascade an extra render on every load.
  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<string | null>(null);

  // Optimistic: the control responds immediately, then reconciles. If the
  // gateway refuses, the override is dropped so the UI cannot drift out of
  // step with what was actually stored.
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

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
          Watchers
        </h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
          Standing instructions that run without you. Every run lands in the
          same plan and the same trace as a session you drove yourself.
        </p>
      </header>

      {failure ? (
        <p
          role="alert"
          className="rounded-brand border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive"
        >
          {failure}
        </p>
      ) : null}

      <Async state={state} reload={reload}>
        {(data) => (
          <ul className="flex flex-col gap-3">
            {data
              .map((w) =>
                paused[w.id] === undefined
                  ? w
                  : {
                      ...w,
                      running: !paused[w.id],
                      lastRun: paused[w.id]
                        ? "Paused just now"
                        : "Resumed just now",
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
                    {/* State is carried by label as well as colour, never colour alone. */}
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
                      {w.running ? "Running" : "Paused"}
                    </span>

                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
                      <ShieldAlert className="size-3.5" aria-hidden="true" />
                      {CEILING_LABELS[w.ceiling]}
                    </span>

                    <span className="text-muted-foreground">{w.lastRunAt ? relativeTime(w.lastRunAt) : "Never run"}</span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Async>

      <p className="rounded-brand border bg-muted/50 p-4 text-[13px] leading-relaxed text-muted-foreground">
        Irreversible actions — external sends, payments, deletions — always stop
        and ask, whatever a watcher’s ceiling is set to. That floor is not yours
        to lower.
      </p>
    </div>
  );
}
