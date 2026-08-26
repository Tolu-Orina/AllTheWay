"""A photograph is the one input a model reads before screening does.

These tests are about the containment around that, not about transcription
quality — which was verified against the live model instead: a clean page came
back accurately, and a page whose text read "IGNORE ALL PREVIOUS INSTRUCTIONS"
was *transcribed rather than obeyed*, then blocked by the screener.
"""

from __future__ import annotations

import pytest

from app.pipeline import IMAGE_TYPES, extract
from app.transcribe import SUPPORTED, TranscriptionFailed, transcribe


def test_the_two_type_lists_cannot_drift():
    """The specific failure this prevents.

    A type accepted by `extract` but refused by `transcribe` raises. A type
    accepted by `transcribe` but missing here is worse: it falls through to the
    "everything else is text" branch, decodes JPEG bytes as UTF-8 with
    replacement characters, and indexes a page of garbage without erroring.
    """
    assert IMAGE_TYPES == SUPPORTED


def test_an_unsupported_image_is_refused_rather_than_guessed_at():
    with pytest.raises(TranscriptionFailed):
        transcribe(b"\x00\x01", "image/tiff")


def test_a_photograph_is_one_page(monkeypatch):
    """Page numbers end up in citations. Inventing them would produce a
    footnote pointing at a page that does not exist."""
    import app.transcribe as t

    monkeypatch.setattr(t, "transcribe", lambda body, mime: "Clause 7.2")
    pages, count = extract(b"fake-jpeg-bytes", "image/jpeg")

    assert count == 1
    assert pages == [(1, "Clause 7.2")]


def test_an_unreadable_photograph_raises_instead_of_indexing_nothing(monkeypatch):
    """An empty transcription and a failed one look identical downstream, and
    they need different answers: one is "try again", the other is "there was
    nothing readable in that photo"."""
    import app.transcribe as t

    def blank(body, mime):
        raise TranscriptionFailed("There was no legible text in that image.")

    monkeypatch.setattr(t, "transcribe", blank)
    with pytest.raises(TranscriptionFailed):
        extract(b"fake", "image/jpeg")


def test_text_and_pdf_still_take_the_mechanical_path():
    # The exception must stay an exception. If this ever routes through a model,
    # the "no model reads unscreened content" invariant is gone for every input.
    pages, count = extract(b"Clause 7.2 applies.", "text/plain")
    assert pages == [(1, "Clause 7.2 applies.")]
    assert count == 1
