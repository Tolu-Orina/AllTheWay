import { BadgeCheck, Lock, ShieldAlert } from "lucide-react";

import type { Agent } from "@/app/data";
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
   * True when the capability is delivered by a service that publishes no card.
   *
   * Nothing sets this now — librarian and scribe gained signed cards in v3, so
   * all four specialists are verifiable. It stays because the distinction is
   * real and will be needed again: a service with no card is not "unverified",
   * and conflating the two either raises a false alarm or hides a true one.
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
  },
  {
    label: "Researcher",
    description: "Goes and finds out, and says where each answer came from.",
    agentId: "research-cell",
  },
];

/**
 * Takes the registry rather than fetching it.
 *
 * This screen already loads it, and asking again meant two identical requests —
 * each of which makes the registry fetch and verify a card from *five* services,
 * any of which may be scaling from zero. On a phone that doubled the wait for no
 * new information.
 */
export function Specialists({ agents }: { agents: Agent[] }) {

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        What it can do
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Each of these is a separate agent with its own published card. The
        version and signature below are read from that card, not from this
        page — so a capability that stops verifying says so here.
      </p>

      <ul className="flex flex-col gap-2">
        {SPECIALISTS.map((specialist) => (
          <SpecialistRow
            key={specialist.agentId}
            specialist={specialist}
            agent={agents.find((a) => a.id === specialist.agentId)}
          />
        ))}
      </ul>
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
