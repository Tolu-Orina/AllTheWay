import { AlertTriangle, Clock, SignalHigh, SignalLow, SignalMedium } from "lucide-react";

import { cn } from "@/lib/utils";
import { QUALITY_LABELS, qualityOf, type Quality } from "@alltheway/contracts";

/**
 * How well the agent is hearing this meeting, said honestly.
 *
 * ## Why show this at all
 *
 * The worst outcome in a meeting is silent degradation: notes that look
 * complete, are not, and are trusted anyway. Somebody acts on a decision that
 * was never made because the three minutes containing the real one are missing
 * and nothing said so.
 *
 * Showing quality while the meeting runs is what lets a person judge for
 * themselves — "it says patchy, I should take my own notes for this bit" is a
 * recovery no amount of post-hoc labelling can offer.
 *
 * ## Degraded is stated, never softened
 *
 * There is deliberately no reassuring middle wording. A connection that is
 * losing audio says it is losing audio, because the alternative is a person
 * discovering it afterwards from a gap in the record.
 */

const ICON: Record<Quality, typeof SignalHigh> = {
  good: SignalHigh,
  degraded: SignalMedium,
  poor: SignalLow,
};

export function ConnectionQuality({
  sample,
}: {
  sample: { packetLoss: number; jitter: number; reconnects: number } | null;
}) {
  if (!sample) return null;

  const quality = qualityOf(sample);
  const Icon = ICON[quality];

  return (
    <p
      // Announced, because a screen-reader user cannot see a signal bar change
      // and this is the one indicator whose whole value is being noticed.
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-[12.5px]",
        quality === "good" && "text-muted-foreground",
        quality === "degraded" && "text-amber-700 dark:text-amber-500",
        quality === "poor" && "text-destructive",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {QUALITY_LABELS[quality]}
    </p>
  );
}

/**
 * The duration cap, and the decision to go past it.
 *
 * The cost is shown in plan units — the same rule as generated media. A person
 * bought an allowance, not a balance, and quoting currency invites them to
 * reason about a number they were never charged.
 */
export function DurationNotice({
  minutesRemaining,
  warn,
  stopped,
  onExtend,
}: {
  minutesRemaining: number;
  warn: boolean;
  stopped: boolean;
  onExtend: (minutes: number) => void;
}) {
  if (!warn && !stopped) return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-brand border border-primary/40 bg-primary/5 px-3.5 py-3"
    >
      <p className="flex items-start gap-2 text-[13px] leading-relaxed">
        {stopped ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        )}
        {stopped
          ? "Note-taking stopped at the 90-minute limit. Nothing after that was recorded."
          : `Note-taking stops in ${minutesRemaining} ${
              minutesRemaining === 1 ? "minute" : "minutes"
            }.`}
      </p>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Meetings are capped so a call nobody closed cannot keep recording all
        day. Another 30 minutes uses about 30 more minutes of your meeting
        allowance.
      </p>

      <button
        type="button"
        onClick={() => onExtend(30)}
        className="self-start rounded-brand border px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
      >
        {stopped ? "Start again for 30 minutes" : "Keep going for 30 more minutes"}
      </button>
    </div>
  );
}
