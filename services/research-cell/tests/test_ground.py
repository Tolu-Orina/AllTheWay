"""Only URLs that came back in grounding metadata leave as sources."""

from types import SimpleNamespace

from app.ground import chunks_from_response, sources_from_chunks


def test_http_urls_are_kept_and_duplicates_and_junk_are_dropped():
    sources = sources_from_chunks(
        [
            {"web": {"title": "Met Office", "uri": "https://www.metoffice.gov.uk/x"}},
            {"web": {"title": "fake", "uri": "not-a-url"}},
            {"web": {"title": "Met Office", "uri": "https://www.metoffice.gov.uk/x"}},
            {"web": {"title": "other", "uri": "http://example.com/a"}},
        ]
    )
    assert [(s.title, s.uri) for s in sources] == [
        ("Met Office", "https://www.metoffice.gov.uk/x"),
        ("other", "http://example.com/a"),
    ]


def test_chunks_from_a_vertex_shaped_response():
    response = SimpleNamespace(
        candidates=[
            SimpleNamespace(
                grounding_metadata=SimpleNamespace(
                    grounding_chunks=[
                        SimpleNamespace(
                            web=SimpleNamespace(
                                title="Met Office",
                                uri="https://www.metoffice.gov.uk/x",
                            )
                        )
                    ]
                )
            )
        ]
    )
    sources = chunks_from_response(response)
    assert sources[0].uri == "https://www.metoffice.gov.uk/x"
    assert sources[0].title == "Met Office"
