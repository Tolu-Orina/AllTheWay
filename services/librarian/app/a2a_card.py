"""The librarian's AgentCard.

Hand-authored, like every other card here: a card is a public contract, so it
belongs in review beside the code it describes rather than derived at runtime
from whatever the service happens to look like.

## Why a plain dict rather than an A2A protobuf

Every other card in this system is built from `a2a.types.AgentCard` and passed
through `MessageToDict`. That requires the A2A SDK and protobuf, and the
librarian has neither — it speaks plain HTTP to the gateway and nothing else.

Adding an SDK to a service so it can describe itself would put a dependency in
the image for the sake of a document. The signature covers canonical JSON of
whatever dict it is given, so the shape is what matters, not what produced it.

## What it does not advertise

There is no skill here for "search someone's documents". The librarian is
reachable only by the gateway and the orchestrator, and every call carries a
scope token bound to one user. A skill implying it can be asked about a corpus
in general would describe a capability that deliberately does not exist.
"""

from __future__ import annotations

import os

CARD_VERSION = "1.0.0"

#: A2A protocol version, matching what the other cards publish. Stated rather
#: than omitted: a registry reading an empty protocolVersion cannot tell an old
#: agent from one that never said.
PROTOCOL_VERSION = "0.3.0"


def _base_url() -> str:
    """Where this service actually answers.

    Read from the environment rather than assumed, because the same image runs
    in dev and prod on different hostnames, and a card advertising the wrong one
    is worse than a card advertising none — it sends callers somewhere real that
    belongs to another environment.
    """
    # PUBLIC_URL, not a new name: Terraform already sets it for every service
    # so a card can advertise where it actually answers. A second convention
    # would be one more thing to set and one more place to forget.
    return os.environ.get("PUBLIC_URL", "").rstrip("/")


def build_card() -> dict:
    """The card as the well-known endpoint serves it, before signing."""
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "name": "Document guide",
        "description": (
            "Holds the documents you add, and answers from them with citations "
            "you can check. It reaches no connector and can act on nothing."
        ),
        "version": CARD_VERSION,
        "url": _base_url(),
        "preferredTransport": "JSONRPC",
        "provider": {
            "organization": "AllTheWay",
            "url": "https://alltheway.rinegansolutions.com",
        },
        "capabilities": {"streaming": False, "pushNotifications": False},
        "defaultInputModes": ["text/plain", "application/pdf"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": "ingest_document",
                "name": "Read a document",
                "description": (
                    "Extract, screen, chunk, embed and index one document for the "
                    "user it belongs to. Screening runs before any model reads it."
                ),
                "tags": ["documents", "retrieval"],
            },
            {
                "id": "retrieve_passages",
                "name": "Find relevant passages",
                "description": (
                    "Return passages from that one user's own documents, with the "
                    "title and page needed to check them. Scoped by a token to a "
                    "single user; there is no way to ask across users."
                ),
                "tags": ["retrieval", "citations"],
            },
        ],
    }
