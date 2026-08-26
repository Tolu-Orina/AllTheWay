import { BadgeCheck, Lock, ShieldAlert } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Agent } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * Named capabilities, and what is actually behind each one.
 *
 * ## A view over the registry, not a second list
 *
 * The registry already knows every agent, its owner, its skills, its card
 * version and whether that card's signature verifies. Specialists are the same
 * facts, named the way a person would ask for them — "the one that reads my
 * documents" rather than "librarian".
 *
 * Keeping it a *view* is the point. A hand-written list of four specialists
 * would drift from what is deployed, and it would drift in the direction of
 * claiming more than is there.
 *
 * ## Specialist theatre is the risk this guards against
 *
 * Four names in front of one prompt is marketing. Each specialist below is
 * bound to a distinct agent, and what it shows — card version, signature, the
 * skills the agent itself published — comes from that agent rather than from
 * this file. If an agent disappears, its specialist says so instead of
 * pretending.
 *
 * ## Unverified is shown as unverified
 *
 * Exactly as on the Agents screen. The governance work is only worth doing if
 * it is visible, and a specialist whose card does not verify is precisely the
 * one a person should know about.
 */

interface Specialist {
  /** How a person would refer to it. */
  label: string;
  description: string;
  /** The id in the registry, when this capability is a published A2A agent. */
  agentId: string;
  /**
   * True when the capability is delivered by an internal service that publishes
   * no card.
   *
   * This distinction is load-bearing. Two of the four below are not A2A agents:
   * they are internal services that nothing outside the product may call, and
   * they have no card to sign because they are not offering themselves to
   * anyone. Showing them as "unverified" would raise an alarm about a control
   * that does not apply to them; showing them as verified would be a lie. So
   * they say what they are.
   */
  internal?: boolean;
}

//: Names, mapped to the agents that already exist. The order is the order
//: someone meets them in: documents, then making things, then meetings, then
//: research.
const SPECIALISTS: Specialist[] = [
  {
    label: "Document guide",
    description: "Reads what you have added and answers with citations you can check.",
    agentId: "librarian",
    // Internal-only by design: it holds your documents, has no connector access
    // and can act on nothing. It publishes no card because it offers itself to
    // no one — see services/librarian/Dockerfile for why that isolation matters.
    internal: true,
  },
  {
    label: "Design partner",
    description: "Drafts and redrafts the thing you are making, and keeps every version.",
    agentId: "orchestrator",
  },
  {
    label: "Meeting scribe",
    description: "Takes notes in meetings. It listens and cannot speak.",
    agentId: "scribe",
    // Also internal. It is reachable by the gateway alone, and deliberately not
    // by the watcher runtime — an unattended process must not decide to join a
    // meeting.
    internal: true,
  },
  {
    label: "Researcher",
    description: "Goes and finds out, and says where each answer came from.",
    agentId: "research-cell",
  },
];

export function Specialists() {
  const { state, reload } = useAsync(() => api.agents());

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        What it can do
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Each of these is a separate service. Where one publishes an agent card,
        the version and signature below are read from that card rather than
        written here.
      </p>

      <Async state={state} reload={reload}>
        {(registry) => (
          <ul className="flex flex-col gap-2">
            {SPECIALISTS.map((specialist) => (
              <SpecialistRow
                key={specialist.agentId}
                specialist={specialist}
                agent={registry.agents.find((a) => a.id === specialist.agentId)}
              />
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}

function SpecialistRow({
  specialist,
  agent,
}: {
  specialist: Specialist;
  agent: Agent | undefined;
}) {
  const trusted = agent?.signature?.trusted ?? false;
  // An internal service is not "unverified" — the control does not apply to it.
  // Conflating the two would either raise a false alarm or hide a real one.
  // Reachable but unsigned is the state worth flagging: something is answering
  // and we cannot prove it is what it claims to be.
  const suspect = !specialist.internal && Boolean(agent?.reachable) && !trusted;

  return (
    <li
      className={cn(
        "rounded-brand border bg-card px-3.5 py-3",
        suspect && "border-destructive/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{specialist.label}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {specialist.description}
          </p>
        </div>

        {specialist.internal ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            Internal
          </span>
        ) : agent ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 text-[12px]",
              trusted ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {trusted ? (
              <BadgeCheck className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-3.5" aria-hidden="true" />
            )}
            {trusted ? "Verified" : "Unverified"}
          </span>
        ) : null}
      </div>

      {specialist.internal ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Runs inside the product and publishes no card — nothing outside can
          call it.
        </p>
      ) : agent ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {agent.version ? (
            <>
              card <span className="tabular-nums">{agent.version}</span>
            </>
          ) : (
            "no card version published"
          )}
          {agent.skills.length ? ` · ${agent.skills.length} published skills` : ""}
        </p>
      ) : (
        // Said plainly rather than hidden. A specialist offered while nothing
        // stands behind it is the exact theatre this view exists to prevent.
        <p className="mt-2 text-[12px] text-destructive">
          Not registered in this deployment — this capability is unavailable.
        </p>
      )}
    </li>
  );
}
