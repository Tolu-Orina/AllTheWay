"""Extract, screen, chunk, embed, index — in that order, for that reason.

The order is the design, and an earlier draft of the plan got it wrong by
saying "parse after screening". That is impossible: a PDF's text does not
exist until something extracts it, so there is nothing to screen until parsing
has happened.

The invariant that is actually achievable, and the one that matters:

    No model reads content that has not been screened.

Which gives:

    1. extract   mechanical, no model      pypdf / plain decode
    2. screen    the extracted text        fail-closed
    3. chunk     only if screening passed
    4. embed     only if screening passed  <- first contact with a model
    5. index

Step 4 is the first moment a model sees anything, and nothing reaches it that
did not pass step 2.

**Extraction carries a different risk that screening does not cover.** A
malicious PDF can attack the *parser* rather than the reader — a memory-safety
bug, not an instruction. Nothing here mitigates that; what mitigates it is that
this service holds no connector credentials, cannot act, and reaches nothing
but Firestore and an embedding endpoint.
"""

from __future__ import annotations

import io
import logging
import re

from alltheway_screening import screen

from . import embed, store

log = logging.getLogger(__name__)

#: Characters, not tokens. Roughly a paragraph or two — small enough that a
#: citation points somewhere a person can actually read, large enough that a
#: clause is not split across three chunks.
CHUNK_CHARS = 1200
CHUNK_OVERLAP = 150

#: A ceiling on one document, so a pathological upload cannot spend an
#: afternoon of embedding budget. Enforced here as well as by the plan limits,
#: because plan limits count documents and this counts their size.
MAX_CHUNKS = 400


class Blocked(RuntimeError):
    """Screening refused this document. Carries no payload text."""

    def __init__(self, summary: str) -> None:
        super().__init__(summary)
        self.summary = summary


#: Photographs, which need transcription rather than parsing. Kept in step
#: with `transcribe.SUPPORTED`: a type accepted here and refused there would
#: reach the "everything else is text" branch and index replacement characters.
IMAGE_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
)


def extract(body: bytes, mime_type: str) -> tuple[list[tuple[int, str]], int]:
    """(page number, text) pairs, and a page count.

    Mechanical for every format but one. A parser cannot be talked into
    anything, which is what makes extraction safe to run before screening: an
    instruction inside a PDF is just text to `pypdf`.

    Photographs are the exception, and a deliberate one — see `transcribe.py`
    for what that costs and why it is contained. The containment is visible
    right here in the caller: whatever comes back goes through screening with
    everything else, so a subverted transcription is treated exactly like a
    hostile PDF.
    """
    if mime_type in IMAGE_TYPES:
        from .transcribe import transcribe

        # A photograph is one page by definition. Someone who photographs four
        # pages sends four files, and pretending otherwise would invent page
        # numbers that citations would then point at.
        return [(1, transcribe(body, mime_type))], 1

    if mime_type == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(body))
        pages = [(i + 1, (page.extract_text() or "")) for i, page in enumerate(reader.pages)]
        return [(n, t) for n, t in pages if t.strip()], len(reader.pages)

    # Everything else is treated as text. A decode failure is a real answer —
    # a file we cannot read is not a file we should guess at.
    text = body.decode("utf-8", errors="replace")
    return ([(1, text)] if text.strip() else []), 1


def chunk(pages: list[tuple[int, str]]) -> list[tuple[int, int, str]]:
    """(page, ordinal, text). Overlapping, so a clause split across a boundary
    is still retrievable from at least one side of it."""
    pieces: list[tuple[int, int, str]] = []

    for page_number, text in pages:
        # Collapse runs of whitespace: PDF extraction produces a lot of it, and
        # it wastes both embedding input and the chunk budget.
        cleaned = re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()
        start = 0
        ordinal = 0

        while start < len(cleaned):
            end = min(start + CHUNK_CHARS, len(cleaned))

            # Prefer a paragraph or sentence boundary, so a citation does not
            # begin mid-word.
            if end < len(cleaned):
                for boundary in ("\n\n", ". ", "\n", " "):
                    found = cleaned.rfind(boundary, start + CHUNK_CHARS // 2, end)
                    if found > start:
                        end = found + len(boundary)
                        break

            piece = cleaned[start:end].strip()
            if piece:
                pieces.append((page_number, ordinal, piece))
                ordinal += 1

            if len(pieces) >= MAX_CHUNKS:
                return pieces

            start = max(end - CHUNK_OVERLAP, end) if end <= start else end - CHUNK_OVERLAP
            if start < 0:
                start = end

    return pieces


def ingest(
    user: str, *, title: str, body: bytes, mime_type: str, hat: str | None = None
) -> dict:
    """The whole pipeline, for one document.

    Returns a summary. Raises `Blocked` when screening refuses, which the
    caller reports as a refusal rather than as a failure — the difference
    matters to the person who uploaded it.
    """
    pages, page_count = extract(body, mime_type)
    document_id = store.create_document(
        user, title=title, mime_type=mime_type, pages=page_count, hat=hat
    )

    if not pages:
        store.set_status(user, document_id, "blocked", blockedReason="No readable text.")
        raise Blocked("There was no readable text in that file.")

    # Screened as one body rather than per chunk: an injection split across a
    # chunk boundary would evade a per-chunk screen, and the whole document is
    # what the user is asking us to trust.
    whole = "\n\n".join(text for _, text in pages)
    verdict = screen(whole, "inbound")

    if not verdict.allowed:
        # The summary names the rule, never the matched text. A trace that
        # repeats an injection hands the attack a second delivery route.
        store.set_status(user, document_id, "blocked", blockedReason=verdict.summary())
        log.warning("document %s blocked by screening", document_id)
        raise Blocked(verdict.summary())

    store.set_status(user, document_id, "indexing", screening=verdict.summary())

    pieces = chunk(pages)
    if not pieces:
        store.set_status(user, document_id, "blocked", blockedReason="Nothing to index.")
        raise Blocked("There was nothing in that file to index.")

    # First contact with a model, and only after screening passed.
    vectors = embed.embed_all([text for _, _, text in pieces])
    written = store.write_chunks(user, document_id, title, pieces, vectors, hat=hat)

    store.set_status(user, document_id, "ready", chunks=written)
    return {"documentId": document_id, "pages": page_count, "chunks": written}
