import { AlertTriangle, ShieldCheck, ShieldX } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Agent } from "@/app/data";
import { cn } from "@/lib/utils";

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
  const { state, reload } = useAsync(() => api.agents());

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
          Agents
        </h1>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
          Every agent this system will talk to, with its published contract
          checked at the moment you asked — not when it was deployed.
        </p>
      </header>

      <Async state={state} reload={reload}>
        {(registry) => (
          <>
            <p className="text-[13px] text-muted-foreground">
              {registry.summary.trusted} of {registry.summary.total} verified
              {registry.summary.reachable < registry.summary.total
                ? ` · ${registry.summary.total - registry.summary.reachable} unreachable`
                : ""}
            </p>

            <ul className="flex flex-col gap-3">
              {registry.agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </ul>
          </>
        )}
      </Async>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const trusted = agent.signature?.trusted ?? false;
  // Reachable but unverified is the case worth shouting about. Unreachable is
  // an availability problem; unverified is a trust problem, and they should
  // not look the same.
  const suspect = agent.reachable && !trusted;

  return (
    <li
      className={cn(
        "rounded-brand border bg-card p-4",
        suspect && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{agent.name || agent.id}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{agent.purpose}</p>
        </div>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
            trusted
              ? "border-primary/30 text-muted-foreground"
              : "border-destructive/40 text-destructive",
          )}
        >
          {trusted ? (
            <ShieldCheck className="size-3.5" aria-hidden="true" />
          ) : (
            <ShieldX className="size-3.5" aria-hidden="true" />
          )}
          {trusted ? "Verified" : "Unverified"}
        </span>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Owner</dt>
          <dd className="font-medium">{agent.owner}</dd>
        </div>
        {agent.version ? (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Card</dt>
            <dd className="font-medium tabular-nums">{agent.version}</dd>
          </div>
        ) : null}
        {agent.signature?.kid ? (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Signed by</dt>
            <dd className="font-medium">{agent.signature.kid}</dd>
          </div>
        ) : null}
      </dl>

      {agent.skills.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {agent.skills.map((skill) => (
            <li
              key={skill.id}
              title={skill.description}
              className="rounded-full border bg-background px-2.5 py-1 text-[12px] text-muted-foreground"
            >
              {skill.name || skill.id}
            </li>
          ))}
        </ul>
      ) : null}

      {suspect ? (
        <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {agent.signature?.summary ?? "This agent's card could not be verified."}{" "}
            Nothing here is attested, including the address it advertises.
          </span>
        </p>
      ) : null}

      {!agent.reachable && agent.error ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">{agent.error}</p>
      ) : null}
    </li>
  );
}
