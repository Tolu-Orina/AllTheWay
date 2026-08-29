import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { useT } from "@/app/i18n";

import { RunningRoster } from "@/app/RunningRoster";

/**
 * The Agent Registry, as a person sees it.
 *
 * Phase 7's exit is that a new agent is discoverable by card alone and that
 * every action is attributable. This is the consumer-facing half of that: what
 * is running, what it can do, who is answerable for it, and whether its card
 * can be trusted.
 *
 * ## An untrusted card is the loudest thing on the page
 *
 * The failure mode this guards against is a catalogue that lists everything
 * calmly and buries the one row that matters. A card that does not verify means
 * its contents are unattested — including the URL it advertises, which is what
 * an A2A client would actually talk to. So it is shown as a warning, not as a
 * grey badge.
 *
 * Unsigned is treated exactly as harshly as invalid. Both mean nobody attested
 * to these contents, and "we could not check" must never read as "it is fine".
 */

export default function Agents() {
  const t = useT();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link
          to="/app/you"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("nav.you")}
        </Link>
        <h1 className="mt-3 text-[26px] leading-tight font-bold tracking-[-0.02em]">
          {t("you.whatsRunning")}
        </h1>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
          {t("common.everyAgentThisSystemWillTalk")}
        </p>
      </header>

      <RunningRoster />
    </div>
  );
}
