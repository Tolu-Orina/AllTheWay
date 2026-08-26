"""Grounded, or silent.

FR-D2, and the trust anchor of the whole document feature. The worst failure
this product can have is not a crash — it is a confident, fluent, wrong summary
of an indemnity clause. Someone acts on that.

## A prompt instruction is not a control

"Always cite your sources" is advisory. The model complies most of the time,
and the times it does not are exactly the times it has invented something —
because a fabricated claim has no source to cite. Relying on the instruction
means the control fails precisely when it is needed.

So citations are a **field**, and this module checks it. Same reasoning as
`plan_validation`: the model's own labelling is a claim, not a fact.

## What is actually enforced

Two rules, both narrow enough to be right:

1. **A citation must name a passage that was actually retrieved.** A model can
   invent a chunk id as easily as a quotation. Any citation not in the
   retrieved set is dropped, and dropping all of them makes the answer
   ungrounded.

2. **If passages were retrieved and the answer cites none, say so.** Not
   refuse — the answer may legitimately come from the conversation rather than
   the documents. But it must not *look* grounded when it is not, so the turn
   carries a visible note instead of quietly implying a source.

## What is deliberately not enforced

We do not check that the cited passage actually supports the claim. That needs
a second model call per claim, and a judge that is wrong in correlated ways
with the thing it is judging. The honest position is that citations make a
claim *checkable by the user*, which is the property that matters — not that
they make it verified.
"""

from __future__ import annotations

from .models import Citation, Passage


def valid_citations(claimed: list[Citation], retrieved: list[Passage]) -> list[Citation]:
    """Citations that name a passage actually retrieved for this turn.

    A model can invent a chunk id as easily as a quotation, so a citation
    pointing at nothing is worse than no citation — it is a footnote that
    looks like evidence.
    """
    known = {p.chunk_id: p for p in retrieved if p.chunk_id}
    kept: list[Citation] = []

    for citation in claimed:
        passage = known.get(citation.chunk_id)
        if passage is None:
            continue
        # Rebuilt from the retrieved passage rather than trusting the model's
        # title and page. Those are display fields, and a wrong page number in
        # a citation is a small lie that destroys trust in the large ones.
        kept.append(
            Citation(chunk_id=passage.chunk_id, title=passage.title, page=passage.page)
        )

    return kept


def check(
    claimed: list[Citation], retrieved: list[Passage]
) -> tuple[list[Citation], list[str]]:
    """Return the citations that survive, and any notes for the trace.

    Notes are user-visible. "I could not ground this" is information someone
    can act on; silence is not.
    """
    kept = valid_citations(claimed, retrieved)
    notes: list[str] = []

    invented = len(claimed) - len(kept)
    if invented > 0:
        notes.append(
            f"Dropped {invented} citation(s) that did not point at anything retrieved."
        )

    if retrieved and not kept:
        # The important case. Documents were consulted and the answer cites
        # none of them, so it must not appear grounded.
        notes.append(
            "This answer is not grounded in your documents — nothing retrieved "
            "supported it."
        )

    return kept, notes
