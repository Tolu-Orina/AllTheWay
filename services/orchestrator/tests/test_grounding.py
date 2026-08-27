"""A citation must be checkable, or it is decoration.

The failure being defended against is the worst one available to this product:
a confident, fluent, wrong summary of a clause someone then acts on. These
tests are written as the ways that failure sneaks through.
"""

from __future__ import annotations

from app.grounding import check, valid_citations
from app.models import Citation, Passage

RETRIEVED = [
    Passage(chunk_id="c1", document_id="d1", title="Supply agreement", page=12, text="..."),
    Passage(chunk_id="c2", document_id="d1", title="Supply agreement", page=13, text="..."),
]


def test_a_citation_naming_a_retrieved_passage_survives():
    kept = valid_citations([Citation(chunk_id="c1")], RETRIEVED)
    assert [c.chunk_id for c in kept] == ["c1"]


def test_an_invented_citation_is_dropped():
    # A model can invent a chunk id as easily as a quotation. A footnote that
    # points at nothing is worse than no footnote — it looks like evidence.
    kept, notes = check([Citation(chunk_id="does-not-exist")], RETRIEVED)
    assert kept == []
    assert any("did not point at anything" in n for n in notes)


def test_title_and_page_come_from_the_passage_not_the_model():
    # A wrong page number is a small lie that destroys trust in the large ones.
    kept = valid_citations(
        [Citation(chunk_id="c2", title="Something else entirely", page=999)], RETRIEVED
    )
    assert kept[0].title == "Supply agreement"
    assert kept[0].page == 13
    # FR-D2: the chip opens this text, so it must be the retrieved passage.
    assert kept[0].text == RETRIEVED[1].text
    assert kept[0].document_id == "d1"


def test_retrieving_documents_and_citing_none_is_said_out_loud():
    """The important case.

    Documents were consulted and the answer cites none of them. It may still be
    a good answer — from the conversation rather than the documents — but it
    must not *appear* grounded.
    """
    kept, notes = check([], RETRIEVED)
    assert kept == []
    assert any("not grounded in your documents" in n for n in notes)


def test_no_documents_and_no_citations_is_not_a_complaint():
    # An ordinary conversational turn. Nothing was retrieved, nothing is
    # claimed, and warning about it would train users to ignore the warning.
    kept, notes = check([], [])
    assert kept == []
    assert notes == []


def test_a_mix_keeps_the_real_ones_and_reports_the_rest():
    kept, notes = check(
        [Citation(chunk_id="c1"), Citation(chunk_id="ghost"), Citation(chunk_id="c2")],
        RETRIEVED,
    )
    assert sorted(c.chunk_id for c in kept) == ["c1", "c2"]
    assert any("Dropped 1 citation" in n for n in notes)
    # Real citations survived, so this is not reported as ungrounded.
    assert not any("not grounded" in n for n in notes)


def test_an_empty_chunk_id_cannot_match_a_passage_with_no_id():
    """A passage missing its id must not become a wildcard that validates
    every empty citation."""
    passages = [Passage(chunk_id="", title="Broken", page=1)]
    assert valid_citations([Citation(chunk_id="")], passages) == []
