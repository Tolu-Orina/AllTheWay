import { AlertTriangle, ShieldCheck, ShieldX } from "lucide-react";
import { useT } from "@/app/i18n";

import { Specialists } from "@/app/Specialists";
import { useAsync } from "@/app/use-async";
import { api, type Agent } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * What is running: the four named specialists, then any published agent cards.
 *
 * The registry may be absent in a local or incomplete deployment. That is not
 * a reason to hide the specialists — they are the product's capabilities, and
 * a 503 used to make this whole section look empty.
 */
export function RunningRoster() {
  const t = useT();
  const { state, reload } = useAsync(() => api.agents());
  const agents = state.status === "ready" ? state.data.agents : [];
  const summary = state.status === "ready" ? state.data.summary : null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <Specialists agents={agents} pending={state.status === "loading"} />

      {state.status === "error" ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {t("you.registryUnavailable")}{" "}
          <button
            type="button"
            onClick={reload}
            className="underline underline-offset-2"
          >
            {t("common.retry")}
          </button>
        </p>
      ) : null}

      {summary ? (
        <p className="text-[13px] text-muted-foreground">
          {summary.trusted} of {summary.total} verified
          {summary.reachable < summary.total
            ? ` · ${summary.total - summary.reachable} unreachable`
            : ""}
        </p>
      ) : null}

      {agents.length ? (
        <ul className="flex flex-col gap-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AgentCard({ agent }: { agent: Agent }) {
  const t = useT();
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
            {t("common.nothingHereIsAttestedIncludingThe")}
          </span>
        </p>
      ) : null}

      {!agent.reachable && agent.error ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">{agent.error}</p>
      ) : null}
    </li>
  );
}
