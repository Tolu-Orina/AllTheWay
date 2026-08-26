import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type MeterReading } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * What this account has spent this month.
 *
 * Phase 8's requirement is that usage is visible *before* a limit is hit, and
 * that is the whole design brief here. Someone told "you have three watcher
 * runs left" can decide what to do with them. Someone who discovers the limit
 * by being refused mid-task cannot, and by then the refusal reads as a fault
 * rather than as a plan working the way they agreed to.
 *
 * So this leads with what remains, not with what has been consumed — and it
 * warns at 80%, while there is still something to act on.
 *
 * These numbers are advisory. Entitlement is decided in the Agent Gateway
 * beside the autonomy floor, which is why nothing here can grant anything.
 */

const LABELS: Record<MeterReading["meter"], string> = {
  voice_minutes: "Voice",
  watcher_runs: "Watcher runs",
  connector_calls: "Connector calls",
};

const UNITS: Record<MeterReading["meter"], string> = {
  voice_minutes: "minutes",
  watcher_runs: "runs",
  connector_calls: "calls",
};

function price(pence: number): string {
  return pence === 0 ? "Free" : `£${(pence / 100).toFixed(0)}/mo`;
}

export function Usage() {
  const { state, reload } = useAsync(() => api.usage());

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        This month
      </h2>

      <Async state={state} reload={reload}>
        {(usage) => (
          <>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              You are on <span className="font-medium text-foreground">{usage.label}</span>
              {usage.pricePence > 0 ? ` — ${price(usage.pricePence)}` : ""}. Voice
              and watcher runs are what actually cost anything, so they are what
              is counted.
            </p>

            <ul className="flex flex-col gap-2">
              {usage.meters.map((meter) => (
                <MeterRow key={meter.meter} reading={meter} />
              ))}
            </ul>
          </>
        )}
      </Async>
    </section>
  );
}

function MeterRow({ reading }: { reading: MeterReading }) {
  const unmetered = reading.limit === null;
  const spent = reading.remaining === 0;
  // Clamped: a counter that overshot its limit should read as full, not as a
  // bar spilling past its own container.
  const pct = unmetered
    ? 0
    : Math.min(100, Math.round((reading.used / Math.max(reading.limit ?? 1, 1)) * 100));

  return (
    <li className="rounded-brand border bg-card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-medium">{LABELS[reading.meter]}</p>
        <p
          className={cn(
            "text-[12.5px] tabular-nums",
            spent ? "text-destructive" : reading.nearLimit ? "text-primary" : "text-muted-foreground",
          )}
        >
          {unmetered ? (
            "Unmetered"
          ) : (
            // Remaining first, deliberately. "12 left" is a number someone can
            // plan against; "38 used" is trivia until it is too late.
            <>
              {reading.remaining} {UNITS[reading.meter]} left
              <span className="text-muted-foreground"> of {reading.limit}</span>
            </>
          )}
        </p>
      </div>

      {unmetered ? null : (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={reading.used}
          aria-valuemin={0}
          aria-valuemax={reading.limit ?? undefined}
          aria-label={`${LABELS[reading.meter]} used`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
              spent ? "bg-destructive" : reading.nearLimit ? "bg-primary" : "bg-foreground/30",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {reading.nearLimit && !spent ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Getting close. Nothing stops working without telling you first.
        </p>
      ) : null}

      {spent ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Used up for this month. Everything else still works.
        </p>
      ) : null}
    </li>
  );
}
