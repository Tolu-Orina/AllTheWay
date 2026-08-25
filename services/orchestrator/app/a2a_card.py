"""The orchestrator's AgentCard.

Hand-authored rather than generated. The card is a public contract — other
agents discover us by it — so it belongs in review alongside the code it
describes, not derived at runtime from whatever the agent happens to look like.

Served at /.well-known/agent-card.json (a2a.utils.constants.AGENT_CARD_WELL_KNOWN_PATH).
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
    url = public_url or os.environ.get("PUBLIC_URL", "http://localhost:8090")

    card = AgentCard(
        name="AllTheWay Orchestrator",
        description=(
            "Decides whether a request is clear enough to act on. Returns a plan "
            "when it is, and asks exactly one question when it is not. Plans only "
            "— it never executes an action."
        ),
        version=CARD_VERSION,
        documentation_url="https://github.com/alltheway/docs",
        icon_url=f"{url}/icons/icon-192.png",
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
            # True as of card 1.1.0: the executor emits TaskStatusUpdateEvent
            # per trace line and TaskArtifactUpdateEvent per plan step. This
            # flipped only once that was real — a card that claims a capability
            # the agent does not have is a lie in a contract other agents rely on.
            streaming=True,
            push_notifications=False,
            extended_agent_card=False,
        ),
        default_input_modes=["text/plain"],
        default_output_modes=["application/json"],
        skills=[
            # One skill, not two. "Clarify" is not a capability — it is the
            # TASK_STATE_INPUT_REQUIRED outcome of this same skill.
            AgentSkill(
                id="plan_session",
                name="Plan a session",
                description=(
                    "Turns a request into an ordered plan of concrete steps. If the "
                    "request is ambiguous the task ends in INPUT_REQUIRED carrying a "
                    "single clarifying question instead of a plan."
                ),
                tags=["planning", "clarification", "session"],
                examples=[
                    "Draft a nav wireframe for the desktop dashboard",
                    "Pull together last year's grant application and update the impact section",
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
