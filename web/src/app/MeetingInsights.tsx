import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, HelpCircle } from "lucide-react";

import { api, type Insight } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * Live insights, on whichever device you are holding.
 *
 * ## Why this exists as well as the extension panel
 *
 * The obvious answer is "the extension already shows these". The reason that is
 * not enough: **while you are screen-sharing, the side panel is visible to
 * everyone in the meeting.** A phone is the only private surface you have — and
 * the whole point of an insight is that it tells you something the room does
 * not know.
 *
 * It also means the insights survive the call. "What did it flag while we were
 * talking?" is a reasonable question afterwards, and one the extension panel
 * cannot answer once the tab is closed.
 *
 * ## Polling, deliberately
 *
 * Insights arrive on a widening schedule — 1, 3, 5, 10, 15 minutes, then every
 * 15 — so the fastest anything appears is once a minute. A socket would buy
 * nothing against that and would have to survive a phone locking, switching
 * from wifi to cellular, and being backgrounded. Polling every twenty seconds
 * is both simpler and more robust on exactly the device this is for.
 *
 * Polling stops when the meeting is no longer live. A phone in someone's pocket
 * should not be asking a server for updates to a meeting that ended.
 */

const POLL_MS = 20_000;

const LABEL: Record<Insight["kind"], string> = {
  contradiction: "Disagrees with your documents",
  context: "Worth knowing",
  unanswered: "Nobody answered this",
};

const ICON: Record<Insight["kind"], typeof AlertTriangle> = {
  contradiction: AlertTriangle,
  context: FileText,
  unanswered: HelpCircle,
};

export function MeetingInsights({
  meetingId,
  live,
}: {
  meetingId: string;
  /** Whether the meeting is still running. Polling stops when it is not. */
  live: boolean;
}) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await api.meetingInsights(meetingId);
        if (!cancelled) {
          setInsights(next);
          setFailed(false);
        }
      } catch {
        // A failed poll is not worth showing. The next one is twenty seconds
        // away, and an error banner on a phone mid-meeting is exactly the
        // interruption this feature is trying not to be.
        if (!cancelled) setFailed(true);
      }
    }

    void load();
    if (!live) return () => void (cancelled = true);

    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [meetingId, live]);

  if (insights.length === 0) {
    // Silence is the ordinary outcome — most passes find nothing that clears
    // the bar — so it is stated rather than left as an empty space that reads
    // like something is broken.
    return (
      <p className="text-[12.5px] text-muted-foreground">
        {live
          ? "Nothing worth interrupting you for yet."
          : failed
            ? "Those could not be loaded."
            : "Nothing was flagged during this meeting."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {insights.map((insight) => {
        const Icon = ICON[insight.kind];
        return (
          <li
            key={insight.id}
            className={cn(
              "rounded-brand border bg-card px-3.5 py-3",
              // Only a contradiction gets colour. If everything is highlighted,
              // the one that matters is not.
              insight.kind === "contradiction" && "border-amber-500/50",
            )}
          >
            <p className="flex items-center gap-1.5 text-[11.5px] tracking-[0.05em] text-muted-foreground uppercase">
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              {LABEL[insight.kind]}
            </p>

            {/* Sized for a phone held one-handed, which is where this is most
                likely to be read. */}
            <p className="mt-1 text-[14px] leading-relaxed">{insight.text}</p>

            {insight.sources.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {insight.sources.map((source, i) => (
                  <li key={i} className="text-[12px] text-muted-foreground">
                    {source.kind === "web" && source.locator ? (
                      <a
                        href={source.locator}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                      >
                        {source.title}
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <>
                        Your documents: {source.title}
                        {source.locator ? ` ${source.locator}` : ""}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
