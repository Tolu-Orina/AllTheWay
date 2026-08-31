"""The librarian: documents in, passages out, for exactly one user.

## There is no `uid` parameter in this file

Not in a path, not in a query string, not in a body. Every route reads the
user out of a **scope token** minted by the gateway — the one service that
verified a Firebase ID token in the first place.

That is layer 4 of the seven defending against cross-user retrieval, and it is
the layer that decides how much code can cause a breach. A `retrieve(uid, ...)`
signature would put the gateway, the orchestrator and everything they call
inside the isolation boundary; any stale variable in any of them becomes a
cross-tenant read. Reading the user from a signed token shrinks that set to one
service.

If you are editing this file and find yourself wanting to accept a user id
because it would be convenient: that is the change this design exists to
prevent.

## Internal-only

Like every backend service here. The browser reaches it through the gateway,
which is the only thing it can talk to.
"""

from __future__ import annotations

import base64
import logging
import os

from alltheway_scopetoken import verify
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import embed, store
from .a2a_card import build_card
from .pipeline import Blocked, ingest
from .quota import document_slot
from .transcribe import TranscriptionFailed

log = logging.getLogger(__name__)

app = FastAPI(title="AllTheWay librarian")

AUDIENCE = "librarian"

#: The gateway's scope-token public key. Empty means nothing verifies, which
#: means nothing is served — never a pass-through.
PUBLIC_KEY = os.environ.get("SCOPE_TOKEN_PUBLIC_KEY", "")

#: A single upload. Larger than a long contract, smaller than a video.
MAX_BYTES = 25 * 1024 * 1024


@app.get("/healthz")
@app.get("/healthz/", include_in_schema=False)
def healthz() -> dict:
    return {"ok": True}


def scoped(token: str | None) -> str:
    """The user this request is for, or a 401.

    The only way a user enters this service.
    """
    scope = verify(token, public_key_pem=PUBLIC_KEY, audience=AUDIENCE)
    if not scope.ok:
        # The reason is logged, not returned: it is diagnostic for us and a
        # probing oracle for anyone else.
        log.warning("scope refused: %s", scope.reason.value)
        raise HTTPException(status_code=401, detail="Not scoped to a user.")
    return scope.user


class IngestRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    #: Base64. JSON is the transport for everything else here, and a multipart
    #: special case would be a second parsing path to keep correct.
    content: str
    mimeType: str = "text/plain"
    #: Optional. Absent means unlabeled. Never inferred from the title.
    hat: str | None = None


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    limit: int = Field(default=6, ge=1, le=20)
    hat: str | None = None
    #: Documents just attached on this turn. Prefer their chunks over a
    #: nearest-neighbour miss, so a question about a file that was just
    #: indexed is answered from that file, not from an older neighbour.
    documentIds: list[str] = Field(default_factory=list, max_length=5)


@app.post("/documents")
def post_document(
    request: IngestRequest,
    x_scope_token: str | None = Header(default=None, alias="X-Scope-Token"),
) -> dict:
    user = scoped(x_scope_token)

    body = base64.b64decode(request.content, validate=False)
    if len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large.")
    if not body:
        raise HTTPException(status_code=400, detail="That file was empty.")

    allowed, message = document_slot(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=message)

    try:
        return ingest(
            user,
            title=request.title,
            body=body,
            mime_type=request.mimeType,
            hat=request.hat if request.hat in {"work", "home", "church"} else None,
        )
    except Blocked as blocked:
        # 422, not 500. Screening refusing a document is the system working,
        # and the user can act on it — a 500 would say the opposite.
        raise HTTPException(status_code=422, detail=blocked.summary) from blocked
    except TranscriptionFailed as failed:
        # Also answerable, and by the person holding the camera: move closer,
        # get more light, straighten the page. A 500 here would send someone to
        # a status page over a photograph they could simply retake.
        raise HTTPException(status_code=422, detail=str(failed)) from failed


@app.get("/.well-known/agent-card.json")
def agent_card() -> dict:
    """The signed card, served where a registry looks for it.

    Signed on every request rather than once at import. The key arrives from
    Secret Manager as an environment variable, and a card signed at import time
    on a revision that started before the secret was bound would serve an
    unsigned card until the next deploy — which reads as a broken key rather
    than a startup ordering problem.

    Unsigned is a supported state: the registry reports it as unverified, which
    is the truth, rather than the service failing to start.
    """
    from alltheway_agentcards import load_private_key, sign
    from alltheway_agentcards.a2a import DEFAULT_KEY_ID, KEY_ID_ENV, SIGNING_KEY_ENV

    card = build_card()

    pem = os.environ.get(SIGNING_KEY_ENV, "").strip()
    if not pem:
        return card

    kid = os.environ.get(KEY_ID_ENV, "").strip() or DEFAULT_KEY_ID
    return sign(card, private_key=load_private_key(pem), kid=kid)


@app.get("/documents")
def get_documents(
    x_scope_token: str | None = Header(default=None, alias="X-Scope-Token"),
) -> dict:
    return {"documents": store.list_documents(scoped(x_scope_token))}


@app.delete("/documents/{document_id}")
def delete_document(
    document_id: str,
    x_scope_token: str | None = Header(default=None, alias="X-Scope-Token"),
) -> dict:
    user = scoped(x_scope_token)
    removed = store.delete_document(user, document_id)
    # Said in the response because FR-D3 requires deletion to be visible: a
    # document you deleted that still answers questions is not deleted.
    return {"deleted": True, "chunksRemoved": removed}


@app.post("/retrieve")
def post_retrieve(
    request: RetrieveRequest,
    x_scope_token: str | None = Header(default=None, alias="X-Scope-Token"),
) -> dict:
    user = scoped(x_scope_token)

    vector = embed.embed_query(request.query)
    hat = request.hat if request.hat in {"work", "home", "church"} else None
    focused = store.chunks_for_documents(user, request.documentIds)
    searched = store.retrieve(user, vector, limit=request.limit, hat=hat)
    passages = store.merge_passages(focused, searched, limit=request.limit)

    return {
        "passages": [
            {
                "chunkId": p.chunk_id,
                "documentId": p.document_id,
                "title": p.title,
                "page": p.page,
                "text": p.text,
                "distance": p.distance,
            }
            for p in passages
        ]
    }
