import { AudioLines, Brain, Radar, ScrollText } from "lucide-react";

import {
  Reveal,
  RevealGroup,
  RevealItem,
} from "@/components/primitives/reveal";
import { cn } from "@/lib/utils";

/** One card shell for every pillar — same border, radius, padding and hover lift. */
function PillarCard({
  id,
  icon: Icon,
  title,
  body,
  visual,
  className,
}: {
  id?: string;
  icon: React.ElementType;
  title: string;
  body: string;
  visual: React.ReactNode;
  className?: string;
}) {
  return (
    <RevealItem className={cn("min-w-0", className)}>
      <article
        id={id}
        className="group flex h-full scroll-mt-24 flex-col gap-5 rounded-brand-lg border bg-card p-6 shadow-e1 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-e2 sm:p-8"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-brand bg-accent text-accent-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <h3 className="text-[20px] leading-snug font-semibold">{title}</h3>
        </div>

        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>

        <div className="mt-auto flex flex-1 flex-col justify-end pt-2">
          {visual}
        </div>
      </article>
    </RevealItem>
  );
}

/* ---------- in-card vignettes: one visual language across all four ---------- */

const WAVE = [10, 20, 34, 46, 28, 14, 38, 52, 40, 22, 12, 32, 44, 26, 16, 10];

function VoiceVisual() {
  return (
    <div className="space-y-3 rounded-brand border bg-background p-4">
      <div className="flex h-14 items-center gap-[3px]" aria-hidden="true">
        {WAVE.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-primary/70"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <p className="text-[14px] leading-relaxed">
        “Here’s what I’ve got: move Thursday’s client call to Friday afternoon,
        and draft the follow-up. Should I go ahead?”
      </p>
      <div className="flex gap-2">
        <span className="rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground">
          Go ahead
        </span>
        <span className="rounded-full border px-3 py-1 text-[12px] text-muted-foreground">
          Not yet
        </span>
      </div>
      <p className="border-t pt-3 text-[13px] text-muted-foreground">
        Nothing was sent. The call moves only after you say so — and the same
        exchange is waiting in text if you would rather read it.
      </p>
    </div>
  );
}

function WatcherVisual() {
  const runs = [
    {
      when: "09:14",
      what: "Client inquiry → proposal drafted",
      state: "Awaiting review",
    },
    { when: "08:02", what: "Transcript → 4 tasks created", state: "Done" },
  ];
  return (
    <div className="divide-y rounded-brand border bg-background text-[13px]">
      {runs.map((r) => (
        <div key={r.when} className="flex items-center gap-3 px-4 py-3">
          <span className="font-medium tabular-nums text-muted-foreground">
            {r.when}
          </span>
          <span className="min-w-0 flex-1 truncate">{r.what}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium",
              r.state === "Done"
                ? "bg-accent text-accent-foreground"
                : "bg-primary/20 text-foreground",
            )}
          >
            {r.state}
          </span>
        </div>
      ))}
    </div>
  );
}

function MemoryVisual() {
  return (
    <div className="space-y-2 rounded-brand border bg-background p-4 text-[13px]">
      <p className="text-muted-foreground">
        Learned from your last three edits
      </p>
      <p className="text-muted-foreground line-through decoration-destructive/60">
        Sidebar nav with 6 top-level items
      </p>
      <p className="rounded-[6px] bg-accent px-2 py-1 font-medium text-accent-foreground">
        Sidebar nav, collapsed by default, 4 items
      </p>
    </div>
  );
}

function GovernanceVisual() {
  const rows = [
    ["Connector scope", "Calendar · read + write, this workspace only"],
    ["Autonomy ceiling", "Draft only — external sends need review"],
    ["Screening", "Inbound email checked for prompt injection"],
  ];
  return (
    <dl className="grid gap-px overflow-hidden rounded-brand border bg-border text-[13px] sm:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="bg-background p-4">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="mt-1 font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pillars() {
  return (
    <section className="border-b bg-background py-20 sm:py-24">
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-[46rem]">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-blue-deep uppercase dark:text-blue-bright">
            One companion, one memory
          </p>
          <h2 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            Not four apps pretending to share context
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            Today that means a voice assistant, an automation tool, a planning
            app and an audit trail — none of which know what the others did.
            AllTheWay is one system where every capability writes to the same
            profile.
          </p>
        </Reveal>

        <RevealGroup className="mt-12 grid gap-4 sm:gap-5 lg:grid-cols-6">
          <PillarCard
            id="voice"
            className="lg:col-span-3 lg:row-span-2"
            icon={AudioLines}
            title="Talk to it like a person"
            body="Real-time spoken conversation that reads tone and pacing instead of waiting for a wake word. Before anything with a side effect runs, it reads back a plain-language summary and waits for your answer."
            visual={<VoiceVisual />}
          />
          <PillarCard
            id="watchers"
            className="lg:col-span-3"
            icon={Radar}
            title="It keeps working while you are away"
            body="Hand it a standing instruction. Watchers run event-driven in the background and report into the same plan you already read."
            visual={<WatcherVisual />}
          />
          <PillarCard
            id="memory"
            className="lg:col-span-3"
            icon={Brain}
            title="It remembers how you think"
            body="Your Cognitive Profile is built from what you actually did and corrected — never from a preferences form you filled in once."
            visual={<MemoryVisual />}
          />
          <PillarCard
            className="lg:col-span-6"
            icon={ScrollText}
            title="And you can audit every bit of it"
            body="Scoped connectors, least-privilege identity between services, and a Transparent Trace of every decision — the same record a security team would ask for, readable by the person it belongs to."
            visual={<GovernanceVisual />}
          />
        </RevealGroup>
      </div>
    </section>
  );
}
