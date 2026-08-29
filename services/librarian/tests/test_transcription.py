"""A photograph is the one input a model reads before screening does.

These tests are about the containment around that, not about transcription
quality — which was verified against the live model instead: a clean page came
back accurately, and a page whose text read "IGNORE ALL PREVIOUS INSTRUCTIONS"
was *transcribed rather than obeyed*, then blocked by the screener.
"""

from __future__ import annotations

import pytest

from app.pipeline import IMAGE_TYPES, extract, pages_from_transcription, sniff_mime
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


def test_an_empty_type_jpeg_is_not_treated_as_text():
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    assert sniff_mime(jpeg, "", "image.jpg") == "image/jpeg"
    assert sniff_mime(jpeg, "text/plain", "photo") == "image/jpeg"
    assert sniff_mime(b"%PDF-1.4\n", "text/plain", "scan.pdf") == "application/pdf"
    assert sniff_mime(b"hello", "image/jpg", "x.jpg") == "image/jpeg"


def test_a_digital_pdf_does_not_call_the_model(monkeypatch):
    import pypdf

    class FakePage:
        def extract_text(self):
            return "Clause 7.2"

    class FakeReader:
        pages = [FakePage()]

    monkeypatch.setattr(pypdf, "PdfReader", lambda *a, **k: FakeReader())

    def boom(*_a, **_k):
        raise AssertionError("must not transcribe a PDF that already has text")

    monkeypatch.setattr("app.transcribe.transcribe", boom)
    pages, count = extract(b"%PDF-1.4 digital", "application/pdf")
    assert pages == [(1, "Clause 7.2")]
    assert count == 1


def test_a_scanned_pdf_is_transcribed(monkeypatch):
    import pypdf

    class FakePage:
        def extract_text(self):
            return ""

    class FakeReader:
        pages = [FakePage(), FakePage()]

    monkeypatch.setattr(pypdf, "PdfReader", lambda *a, **k: FakeReader())
    monkeypatch.setattr(
        "app.transcribe.transcribe",
        lambda _body, mime: "--- page 1 ---\nScanned clause\n--- page 2 ---\nMore",
    )
    pages, count = extract(b"%PDF-1.4 scanned", "application/pdf")
    assert pages == [(1, "Scanned clause"), (2, "More")]
    assert count == 2


def test_page_marks_split_a_transcription():
    assert pages_from_transcription("--- page 1 ---\nA\n--- page 2 ---\nB") == [
        (1, "A"),
        (2, "B"),
    ]
    assert pages_from_transcription("just text") == [(1, "just text")]
