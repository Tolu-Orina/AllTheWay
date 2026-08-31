"""The research cell's AgentCard.

Hand-authored rather than generated. The card is a public contract — other
agents discover us by it — so it belongs in review alongside the code it
describes, not derived at runtime from whatever the agent happens to look like.

## The card is where FR-10 is advertised

One skill, one output mode, one artifact. A caller reading this card cannot
discover a way to address a worker, ask for the raw findings, or run more than
one angle, because the card offers no such surface. The swarm is not something
the cell exposes and asks you not to use — it is not exposed.

Served at /.well-known/agent-card.json.
"""

from __future__ import annotations

import os

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentProvider,
    AgentSkill,
    HTTPAuthSecurityScheme,
    SecurityScheme,
)
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT

from .budget import Budget

#: Bumped when the card's contract changes, independently of the service build.
CARD_VERSION = "1.1.0"

#: Name of the security scheme entry, referenced from security_requirements.
BEARER_SCHEME = "service_oidc"


def build_agent_card(public_url: str | None = None) -> AgentCard:
    """Build the card for this deployment.

    `public_url` differs per environment, so it is the only part injected: the
    capabilities and skills a card advertises must not vary between dev and
    prod, or the card stops being a contract.
    """
    url = public_url or os.environ.get("PUBLIC_URL", "http://localhost:8093")
    budget = Budget()

    card = AgentCard(
        name="AllTheWay Research Cell",
        description=(
            "Researches one topic with a bounded swarm: two workers in parallel, "
            "then a single synthesis. Returns exactly one synthesised answer — "
            "worker output never leaves the cell. Never takes an action."
        ),
        version=CARD_VERSION,
        documentation_url="https://github.com/alltheway/docs",
        provider=AgentProvider(
            organization="AllTheWay",
            url="https://alltheway.rinegansolutions.com",
        ),
        supported_interfaces=[
            AgentInterface(
                url=url,
                protocol_binding="JSONRPC",
                protocol_version=PROTOCOL_VERSION_CURRENT,
            )
        ],
        capabilities=AgentCapabilities(
            # The answer is not incremental — there is one synthesis at the end —
            # but progress is. The executor narrates the fan-out as status
            # updates so a caller can relay "two workers are running" to a user
            # instead of showing a spinner over a silent twenty seconds.
            streaming=True,
            push_notifications=False,
            extended_agent_card=False,
        ),
        default_input_modes=["text/plain"],
        default_output_modes=["application/json"],
        skills=[
            # One skill. There is deliberately no skill that addresses a worker,
            # returns raw findings, or widens the swarm: the card is the outer
            # boundary of what this service can be asked to do.
            AgentSkill(
                id="research_topic",
                name="Research a topic",
                description=(
                    "Looks the topic up (grounded web search), then investigates "
                    "from two independent angles and returns a single synthesised "
                    "answer with a trace of how it was produced. Worker output never "
                    "leaves the cell. "
                    f"Bounded in code: {budget.workers} workers, {budget.rounds} round, "
                    f"{budget.wall_clock_s:g}s wall clock, "
                    f"{budget.total_output_tokens} output tokens. Degrades to a partial "
                    "answer rather than failing when a worker does not return."
                ),
                tags=["research", "synthesis", "bounded"],
                examples=[
                    "whether four-day weeks reduce burnout",
                    "the current state of evidence on microplastics in drinking water",
                ],
                input_modes=["text/plain"],
                output_modes=["application/json"],
            )
        ],
    )

    # Service-to-service auth is a Google-signed OIDC ID token in an
    # Authorization: Bearer header — the same identity Terraform already grants
    # run.invoker to. No API keys: there is no key in this architecture today
    # and introducing one would create the first thing worth stealing.
    card.security_schemes[BEARER_SCHEME].CopyFrom(
        SecurityScheme(
            http_auth_security_scheme=HTTPAuthSecurityScheme(
                description="Google-signed OIDC identity token for the calling service account.",
                scheme="bearer",
                bearer_format="JWT",
            )
        )
    )
    # An empty scope list means 'this scheme, no additional scopes' — the
    # bearer token itself is the whole requirement.
    requirement = card.security_requirements.add()
    requirement.schemes[BEARER_SCHEME].list.extend([])

    return card
