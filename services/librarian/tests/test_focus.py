"""Focused retrieval prefers attached documents."""

from app.store import Passage, merge_passages


def p(chunk: str, document: str = "d1") -> Passage:
    return Passage(
        chunk_id=chunk,
        document_id=document,
        title="File.pdf",
        page=1,
        text="clause",
        distance=0.1,
        hat=None,
    )


def test_focused_chunks_come_first():
    focused = [p("a"), p("b")]
    searched = [p("c"), p("a")]
    merged = merge_passages(focused, searched, limit=3)
    assert [m.chunk_id for m in merged] == ["a", "b", "c"]


def test_merge_respects_the_limit():
    focused = [p("a"), p("b"), p("c")]
    merged = merge_passages(focused, [p("d")], limit=2)
    assert [m.chunk_id for m in merged] == ["a", "b"]
