"""Fetching each agent's card and saying whether it can be trusted.

## The registry reports; it never routes

Nothing here decides where a call goes. That matters: an unverified card is
information about a problem, not a thing to act on. A registry that quietly
used a card it could not verify would be worse than no registry, because it
would launder an unsigned card into an authoritative-looking catalogue entry.

So every entry carries its signature state, including the bad ones, and the
bad ones are the entries most worth showing.

## Fetching is authenticated, like every other internal call

The agents are `INGRESS_TRAFFIC_INTERNAL_ONLY` and require an ID token per
audience. This uses the same `libs/agentauth` path the A2A clients use, so
there is one way to authenticate between services rather than two that drift.

## A slow agent must not stall the catalogue

Cards are fetched concurrently with a per-agent timeout. One unreachable agent
degrades its own row and nothing else — the same shape as the research cell's
degradation, and for the same reason: a catalogue that fails entirely because
one member is down tells you less than one that says which member is down.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
from alltheway_agentcards import Reason
from alltheway_agentcards.a2a import verify_card
from alltheway_agentauth import auth_headers

from .roster import Entry, configured

CARD_PATH = "/.well-known/agent-card.json"

#: Short. The registry is a read of live state, and a caller waiting fifteen
#: seconds for a catalogue would rather have a row marked unreachable.
FETCH_TIMEOUT_SECONDS = float(os.environ.get("REGISTRY_FETCH_TIMEOUT", "5"))


@dataclass(frozen=True)
class Signature:
    state: str
    kid: str
    summary: str
    trusted: bool


@dataclass
class AgentRecord:
    id: str
    owner: str
    purpose: str
    url: str
    reachable: bool = False
    name: str = ""
    description: str = ""
    version: str = ""
    protocol_version: str = ""
    skills: list[dict[str, str]] = field(default_factory=list)
    #: The URL the card itself advertises. Shown next to `url` because a
    #: mismatch is the exact thing card signing exists to make detectable.
    advertised_url: str = ""
    signature: Signature | None = None
    error: str = ""

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "owner": self.owner,
            "purpose": self.purpose,
            "url": self.url,
            "reachable": self.reachable,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "protocolVersion": self.protocol_version,
            "skills": self.skills,
            "advertisedUrl": self.advertised_url,
            "signature": (
                {
                    "state": self.signature.state,
                    "kid": self.signature.kid,
                    "summary": self.signature.summary,
                    "trusted": self.signature.trusted,
                }
                if self.signature
                else None
            ),
            "error": self.error,
        }


def _skills_of(card: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for skill in card.get("skills") or []:
        if isinstance(skill, dict):
            out.append(
                {
                    "id": str(skill.get("id", "")),
                    "name": str(skill.get("name", "")),
                    "description": str(skill.get("description", "")),
                }
            )
    return out


def _advertised(card: dict[str, Any]) -> str:
    for interface in card.get("supportedInterfaces") or []:
        if isinstance(interface, dict) and interface.get("url"):
            return str(interface["url"])
    return ""


async def _fetch(client: httpx.AsyncClient, entry: Entry) -> AgentRecord:
    record = AgentRecord(
        id=entry.id, owner=entry.owner, purpose=entry.purpose, url=entry.url
    )

    if not entry.url:
        record.error = f"No URL configured ({entry.url_env} is unset)."
        return record

    try:
        response = await client.get(
            f"{entry.url}{CARD_PATH}",
            headers=auth_headers(entry.url),
            timeout=FETCH_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        record.error = f"Could not reach this agent ({type(exc).__name__})."
        return record

    if response.status_code != 200:
        record.error = f"Card fetch returned HTTP {response.status_code}."
        return record

    try:
        card = response.json()
    except ValueError:
        record.error = "The card was not JSON."
        return record

    if not isinstance(card, dict):
        record.error = "The card was not an object."
        return record

    record.reachable = True
    record.name = str(card.get("name", ""))
    record.description = str(card.get("description", ""))
    record.version = str(card.get("version", ""))
    record.protocol_version = str(card.get("protocolVersion", ""))
    record.skills = _skills_of(card)
    record.advertised_url = _advertised(card)

    result = verify_card(card)
    record.signature = Signature(
        state=str(result.reason.value),
        kid=result.kid,
        summary=result.summary(),
        # Only OK is trusted. UNSIGNED is not a lesser failure than INVALID
        # here — both mean the card's contents are unattested, and the whole
        # point is that "we could not check" never reads as "it is fine".
        trusted=result.reason is Reason.OK,
    )
    return record


async def describe() -> dict[str, Any]:
    """The catalogue, as of now."""
    entries = configured()

    async with httpx.AsyncClient() as client:
        records = await asyncio.gather(
            *(_fetch(client, entry) for entry in entries), return_exceptions=False
        )

    return {
        "agents": [record.as_json() for record in records],
        "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": {
            "total": len(records),
            "reachable": sum(1 for r in records if r.reachable),
            "trusted": sum(1 for r in records if r.signature and r.signature.trusted),
        },
    }


async def describe_one(agent_id: str) -> dict[str, Any] | None:
    from .roster import BY_ID

    entry = BY_ID.get(agent_id)
    if entry is None:
        return None
    async with httpx.AsyncClient() as client:
        record = await _fetch(client, entry)
    return record.as_json()
