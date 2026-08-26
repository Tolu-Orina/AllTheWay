"""Attaching a signature to an A2A AgentCard, and checking one.

Kept apart from the crypto in `__init__` because this half is about the
protobuf, and it is the half where the mistake is easy: signing a
representation of the card that is not the one served.

## Sign what is actually served, byte for byte

The route serialises the card with protobuf JSON — camelCase, empty fields
omitted. Signing a hand-built dict, or a snake_case one, produces a signature
that verifies against a document nobody ever sends. It would pass its own
tests and fail against every real client.

So the payload is `MessageToDict(card)`, which was checked against the served
response and found identical. If the SDK ever changes how it serialises, the
signature stops verifying — loudly, in a test — rather than silently covering
the wrong bytes.
"""

from __future__ import annotations

import os
from typing import Any

from . import Result, load_private_key, load_public_key, sign, verify

#: Set from Secret Manager. Absent means this deployment does not sign, which
#: is a supported state: cards are still served, and a verifier that requires
#: signatures will refuse them rather than being silently satisfied.
SIGNING_KEY_ENV = "AGENT_CARD_SIGNING_KEY"
PUBLIC_KEY_ENV = "AGENT_CARD_PUBLIC_KEY"
KEY_ID_ENV = "AGENT_CARD_KEY_ID"

DEFAULT_KEY_ID = "alltheway"


def card_payload(card: Any) -> dict:
    """The card as the well-known endpoint serves it.

    protobuf is imported here rather than at module scope, and that is not
    tidiness. Only *signing* needs it — a verifier is handed the parsed JSON
    that arrived on the wire and never touches a protobuf message. Importing it
    at the top made this module unusable in any service that verifies without
    also serving a card, which is precisely what the registry does: its build
    failed with `No module named google.protobuf` because it has no reason to
    depend on the A2A SDK at all.
    """
    from google.protobuf.json_format import MessageToDict

    return MessageToDict(card)


def attach_signature(card: Any) -> bool:
    """Sign the card in place. Returns whether it was signed.

    Mutates rather than returning a copy because the SDK builds its routes from
    the card object at import time — a signed copy would be signed and unused,
    which is the failure mode this whole module exists to avoid.
    """
    pem = os.environ.get(SIGNING_KEY_ENV, "").strip()
    if not pem:
        return False

    kid = os.environ.get(KEY_ID_ENV, "").strip() or DEFAULT_KEY_ID
    signed = sign(card_payload(card), private_key=load_private_key(pem), kid=kid)

    entry = signed["signatures"][0]
    del card.signatures[:]
    signature = card.signatures.add()
    signature.protected = entry["protected"]
    signature.signature = entry["signature"]
    return True


def verify_card(payload: dict, *, public_key_pem: str | None = None, kid: str | None = None) -> Result:
    """Check a fetched card's signature.

    Takes the parsed JSON rather than a protobuf on purpose: a client verifies
    what arrived on the wire, not what its own parser reconstructed from it.
    """
    pem = public_key_pem if public_key_pem is not None else os.environ.get(PUBLIC_KEY_ENV, "")
    key_id = kid or os.environ.get(KEY_ID_ENV, "").strip() or DEFAULT_KEY_ID
    if not pem.strip():
        return verify(payload, public_keys={})
    return verify(payload, public_keys={key_id: load_public_key(pem)})
