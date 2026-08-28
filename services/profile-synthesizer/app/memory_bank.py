"""Optional Memory Bank extractor. Not the profile.

When MEMORY_BANK_RESOURCE is unset, this returns nothing and is not called.
When set, retrieve USER_PREFERENCES only — never USER_PERSONAL_INFO — and
map facts onto proposed ledger rows the user can still revert.

GenerateMemories is not invoked from session transcripts. Voice and school-run
chat are not a synthesizer source.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .generalise import Proposal

log = logging.getLogger("profile-synthesizer.memory-bank")

#: Full reasoning-engine resource:
#: projects/{p}/locations/{l}/reasoningEngines/{engine}
RESOURCE = "MEMORY_BANK_RESOURCE"


def propose_from_bank(uid: str) -> list[Proposal]:
    """Unlabelled proposals. A bank fact has no hat; stamping the hat of
    the correction that happened to trigger this pass would mix scopes."""
    resource = os.environ.get(RESOURCE, "").strip()
    if not resource:
        return []
    try:
        facts = _retrieve_preferences(uid, resource)
    except Exception as exc:
        log.warning("memory bank extractor failed: %s", exc)
        return []

    out: list[Proposal] = []
    for i, fact in enumerate(facts):
        text = fact.strip()
        if not text:
            continue
        # Bank facts have no was/now pair. They land as proposed until the
        # person accepts — a black-box extraction does not auto-activate.
        out.append(
            Proposal(
                area="General",
                was="(from Memory Bank)",
                now=text,
                evidence="Proposed from Memory Bank USER_PREFERENCES",
                confidence=0.45,
                proposed=True,
                key=f"synth:bank:any:{i}:{text.casefold()[:24]}",
                hat=None,
            )
        )
        if len(out) >= 5:
            break
    return out


def _retrieve_preferences(uid: str, resource: str) -> list[str]:
    """POST .../memories:retrieve, filtered to USER_PREFERENCES.

    google-auth is optional: a synthesizer image without it simply does not
    extract, which is the same as MEMORY_BANK_RESOURCE being unset.
    """
    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
    except ImportError as exc:
        raise RuntimeError("google-auth is not installed in this image") from exc

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    session = AuthorizedSession(credentials)
    location = _location_of(resource)
    host = "aiplatform.googleapis.com" if location == "global" else f"{location}-aiplatform.googleapis.com"
    url = f"https://{host}/v1beta1/{resource}/memories:retrieve"
    body: dict[str, Any] = {
        "scope": {"user_id": uid},
        "filter": "topics.managed_memory_topic: USER_PREFERENCES",
    }
    response = session.post(url, json=body, timeout=20)
    if not response.ok:
        raise RuntimeError(f"retrieve returned HTTP {response.status_code}")
    payload = response.json()
    facts: list[str] = []
    for item in payload.get("retrievedMemories", payload.get("memories", [])):
        memory = item.get("memory", item) if isinstance(item, dict) else {}
        fact = memory.get("fact") if isinstance(memory, dict) else None
        if isinstance(fact, str) and text_ok(fact):
            facts.append(fact)
    return facts


def text_ok(fact: str) -> bool:
    # A bank fact that looks like a name, school, or child is out of topic.
    lowered = fact.casefold()
    banned = ("child", "daughter", "son", "school run", "ssn", "passport")
    return not any(word in lowered for word in banned)


def _location_of(resource: str) -> str:
    parts = resource.split("/")
    try:
        return parts[parts.index("locations") + 1]
    except (ValueError, IndexError):
        return "global"
