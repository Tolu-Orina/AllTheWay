"""Which agents exist, and who is answerable for each.

The registry is a catalogue of AgentCards — that is why Phase 1's decision to
hand-author and commit the cards pays off twice. Almost everything shown here
comes from the card itself, fetched live. This file holds only what a card
cannot tell you.

## Ownership is not self-declared

An agent's card says what it does. It cannot say who is accountable when it
does the wrong thing, because a card is written by the thing being described.
Owner therefore lives here, in a file that is reviewed, and a new agent becomes
discoverable by being added to a diff someone reads.

## URLs come from the environment, not from here

Terraform derives every service URL from Cloud Run's deterministic form and
injects it, exactly as it does for the peer URLs the agents use to reach each
other. Hard-coding them here would create a second source of truth that is
wrong in dev the moment anything moves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Entry:
    """One agent, as the registry knows it before fetching anything."""

    id: str
    #: The team or person answerable for this agent. Not a display name.
    owner: str
    #: Why it exists, in one line, for someone browsing the catalogue.
    purpose: str
    #: Environment variable carrying its base URL.
    url_env: str

    @property
    def url(self) -> str:
        return os.environ.get(self.url_env, "").strip().rstrip("/")


#: First-party agents. A third-party agent registering itself is Phase 7's
#: stated goal — "a new agent is discoverable by card alone" — and when that
#: arrives it becomes a Firestore collection with the same fields, not a
#: different shape. Keeping this list and that collection identical in shape is
#: what makes the transition a data migration rather than a rewrite.
AGENTS: tuple[Entry, ...] = (
    Entry(
        id="orchestrator",
        owner="core",
        purpose="Plans a turn, runs the Clarify Gate, and delegates research.",
        url_env="ORCHESTRATOR_URL",
    ),
    Entry(
        id="research-cell",
        owner="core",
        purpose="A bounded swarm that returns one synthesised answer.",
        url_env="RESEARCH_CELL_URL",
    ),
    Entry(
        id="connector-gateway",
        owner="core",
        purpose="The single enforcement point in front of every connector.",
        url_env="CONNECTOR_GATEWAY_URL",
    ),
)

BY_ID = {entry.id: entry for entry in AGENTS}


def configured() -> tuple[Entry, ...]:
    """Agents this deployment can actually reach.

    An entry with no URL is not an error and not hidden — it is reported as
    unreachable by `describe`. Silently dropping it would make a
    misconfiguration look like an agent that was never meant to exist.
    """
    return AGENTS
