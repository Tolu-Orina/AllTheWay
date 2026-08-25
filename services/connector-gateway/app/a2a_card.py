"""The Agent Gateway's AgentCard.

Hand-authored rather than generated. The card is a public contract — other
agents discover us by it — so it belongs in review alongside the code it
describes, not derived at runtime from whatever the agent happens to look like.

## One skill, on purpose

`use_connector` is the only way to reach a connector. There is deliberately no
"raw MCP passthrough" skill: a second entrance would be a second place to
enforce scope, rate limits and the autonomy floor, and the manifest's whole
requirement here is that there is exactly one.

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

#: Bumped when the card's contract changes, independently of the service build.
CARD_VERSION = "1.0.0"

#: Name of the security scheme entry, referenced from security_requirements.
BEARER_SCHEME = "service_oidc"


def build_agent_card(public_url: str | None = None) -> AgentCard:
    """Build the card for this deployment.

    `public_url` differs per environment, so it is the only part injected: the
    capabilities and skills a card advertises must not vary between dev and
    prod, or the card stops being a contract.
    """
    url = public_url or os.environ.get("PUBLIC_URL", "http://localhost:8094")

    card = AgentCard(
        name="AllTheWay Agent Gateway",
        description=(
            "The single policy enforcement point in front of every connector. "
            "Enforces scope, the autonomy floor, rate limits and per-connector "
            "quotas, executes over MCP, and screens whatever comes back."
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
            # A connector call is one round trip; there is nothing to stream.
            # Saying so is the honest card: a caller that asks for streaming
            # would otherwise be relying on a fallback rather than a contract.
            streaming=False,
            push_notifications=False,
            extended_agent_card=False,
        ),
        default_input_modes=["application/json"],
        default_output_modes=["application/json"],
        skills=[
            AgentSkill(
                id="use_connector",
                name="Use a connector",
                description=(
                    "Calls one tool on one connector, after checking it is within the "
                    "user's grant, permitted by the autonomy floor, confirmed where "
                    "that is required, and inside the connector's rate limit and "
                    "daily quota. Whatever the tool returns is screened before it is "
                    "handed back. Refusals say which check failed."
                ),
                tags=["connectors", "mcp", "policy", "enforcement"],
                examples=[
                    "calendar.list_events",
                    "calendar.send_invite (requires confirmation)",
                ],
                input_modes=["application/json"],
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
