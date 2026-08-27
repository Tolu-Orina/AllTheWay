import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Async } from "@/app/async";
import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { api, type MeterReading, type Usage as UsageData } from "@/app/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/primitives/app-link";

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
 * beside the autonomy floor, which is why nothing here can grant anything —
 * including the `?billing=ok` return from Checkout.
 */

const LABELS: Record<MeterReading["meter"], string> = {
  voice_minutes: "Voice",
  watcher_runs: "Watcher runs",
  connector_calls: "Connector calls",
  documents: "Documents",
  meeting_insights: "Live meeting insights",
  images: "Images",
  draft_video_seconds: "Video drafts",
  final_video_seconds: "Final video",
};

const UNITS: Record<MeterReading["meter"], string> = {
  voice_minutes: "minutes",
  watcher_runs: "runs",
  connector_calls: "calls",
  documents: "stored",
  meeting_insights: "checks",
  images: "images",
  draft_video_seconds: "seconds",
  final_video_seconds: "seconds",
};

function price(pence: number): string {
  return pence === 0 ? "Free" : `£${(pence / 100).toFixed(0)}/mo`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/**
 * Checkout returns here with `?billing=ok`. Poll usage until Stripe's webhook
 * has written the chosen plan, or until 15s, then tell them to refresh. The
 * query string never grants a plan.
 */
export function BillingReturnBanner({ onChanged }: { onChanged?: () => void }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const billing = params.get("billing");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (billing === "cancelled") {
      setNote(t("usage.checkoutCancelled"));
      return;
    }
    if (billing !== "ok") return;

    const wanted = params.get("plan");
    let live = true;
    setNote(t("usage.updatingPlan"));
    const deadline = Date.now() + 15_000;

    void (async () => {
      while (live && Date.now() < deadline) {
        try {
          const usage = await api.usage();
          const landed =
            wanted === "plus" || wanted === "max"
              ? usage.tier === wanted
              : usage.tier !== "free";
          if (landed) {
            if (live) {
              setNote(null);
              onChanged?.();
              params.delete("billing");
              params.delete("plan");
              setParams(params, { replace: true });
            }
            return;
          }
        } catch {
          /* keep polling — a blip must not look like a failed payment */
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (live) setNote(t("usage.refreshIfNotUpdated"));
    })();

    return () => {
      live = false;
    };
  }, [billing, onChanged, params, setParams, t]);

  if (!note) return null;
  return (
    <p role="status" className="text-[13.5px] leading-relaxed text-muted-foreground">
      {note}
    </p>
  );
}

export function Usage({ heading }: { heading?: string }) {
  const t = useT();
  const { state, reload } = useAsync(() => api.usage());
  const [busy, setBusy] = useState<"plus" | "max" | "portal" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function go(kind: "plus" | "max" | "portal") {
    setActionError(null);
    setBusy(kind);
    try {
      const { url } =
        kind === "portal" ? await api.billingPortal() : await api.billingCheckout(kind);
      window.location.assign(url);
    } catch (err) {
      setBusy(null);
      setActionError(
        err instanceof Error ? err.message : "Billing is not available right now.",
      );
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {heading ?? t("usage.thisMonth")}
      </h2>

      <BillingReturnBanner onChanged={reload} />

      <Async state={state} reload={reload}>
        {(usage) => (
          <>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              You are on <span className="font-medium text-foreground">{usage.label}</span>
              {usage.pricePence > 0 ? ` — ${price(usage.pricePence)}` : ""}.{" "}
              {t("usage.metersHint")}
            </p>

            {usage.status === "past_due" ? (
              <p role="status" className="text-[13.5px] text-muted-foreground">
                {t("usage.paymentFailed")}
              </p>
            ) : null}

            {usage.cancelAtPeriodEnd && usage.currentPeriodEnd ? (
              <p className="text-[13.5px] text-muted-foreground">
                {t("usage.cancelsOn", { date: formatDay(usage.currentPeriodEnd) })}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {usage.tier === "free" ? (
                <>
                  <Button
                    type="button"
                    variant="brand"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void go("plus")}
                  >
                    {busy === "plus" ? "…" : t("usage.upgrade")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void go("max")}
                  >
                    {busy === "max" ? "…" : t("usage.getMax")}
                  </Button>
                </>
              ) : null}
              {usage.tier === "plus" ? (
                <Button
                  type="button"
                  variant="brand"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void go("max")}
                >
                  {busy === "max" ? "…" : t("usage.getMax")}
                </Button>
              ) : null}
              {usage.hasBilling ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void go("portal")}
                >
                  {busy === "portal" ? "…" : t("usage.manage")}
                </Button>
              ) : null}
            </div>

            {actionError ? (
              <p role="alert" className="text-[13px] text-destructive">
                {actionError}
              </p>
            ) : null}

            <p className="text-[12.5px] text-muted-foreground">{t("usage.sharingIsTeam")}</p>

            <ul className="flex flex-col gap-2">
              {usage.meters
                .filter((meter) => !(meter.meter === "meeting_insights" && meter.limit === 0))
                .map((meter) => (
                <MeterRow
                  key={meter.meter}
                  reading={meter}
                  usage={usage}
                  onUpgrade={(target) => void go(target)}
                />
              ))}
            </ul>
            {usage.meters.some((m) => m.meter === "meeting_insights" && m.limit === 0) ? (
              <p className="text-[12.5px] text-muted-foreground">
                {t("usage.meetingsAreTeam")}{" "}
                <Link href="/contact" className="underline underline-offset-2">
                  {t("usage.talkToUs")}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </Async>
    </section>
  );
}

function upgradeTarget(
  meter: MeterReading["meter"],
  tier: UsageData["tier"],
): "plus" | "max" | "team" | null {
  if (tier === "max" || tier === "team") return null;
  if (meter === "meeting_insights") return "team";
  if (meter === "final_video_seconds" || meter === "draft_video_seconds") return "max";
  if (tier === "plus") return "max";
  return "plus";
}

function MeterRow({
  reading,
  usage,
  onUpgrade,
}: {
  reading: MeterReading;
  usage: UsageData;
  onUpgrade: (target: "plus" | "max") => void;
}) {
  const t = useT();
  const unmetered = reading.limit === null;
  const spent = reading.remaining === 0;
  const target = upgradeTarget(reading.meter, usage.tier);
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
          {t("usage.gettingCloseNothingStopsWorkingWit")}
          <UpgradeHint target={target} onUpgrade={onUpgrade} />
        </p>
      ) : null}

      {spent ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {reading.meter === "documents"
            ? t("usage.documentsFull")
            : reading.meter === "meeting_insights"
              ? t("usage.meetingsAreTeam")
              : reading.meter === "final_video_seconds"
                ? t("usage.videoIsMax")
                : t("usage.usedUpForThisMonthEverything")}
          <UpgradeHint target={target} onUpgrade={onUpgrade} />
        </p>
      ) : null}
    </li>
  );
}

function UpgradeHint({
  target,
  onUpgrade,
}: {
  target: "plus" | "max" | "team" | null;
  onUpgrade: (target: "plus" | "max") => void;
}) {
  const t = useT();
  if (!target) return null;
  if (target === "team") {
    return (
      <>
        {" "}
        <Link href="/contact" className="underline underline-offset-2">
          {t("usage.talkToUs")}
        </Link>
      </>
    );
  }
  return (
    <>
      {" "}
      <button
        type="button"
        className="underline underline-offset-2"
        onClick={() => onUpgrade(target)}
      >
        {target === "max" ? t("usage.getMax") : t("usage.upgrade")}
      </button>
    </>
  );
}
