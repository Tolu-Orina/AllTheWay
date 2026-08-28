"""Video start/poll helpers, without calling Vertex.

The generation path is billed. These tests cover the operation-name parsing
and JSON shapes the gateway relies on, with httpx stubbed.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "media_server",
    Path(__file__).resolve().parents[1] / "connectors" / "media_server.py",
)
assert SPEC and SPEC.loader
media_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(media_server)


def test_model_is_read_from_the_operation_name():
    name = (
        "projects/p/locations/global/publishers/google/models/"
        "veo-3.1-lite-generate-001/operations/abc"
    )
    assert media_server._model_from_operation(name) == "veo-3.1-lite-generate-001"


def test_an_empty_operation_has_no_model():
    assert media_server._model_from_operation("") == ""


def test_start_returns_the_operation_without_waiting(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {"name": "projects/p/locations/global/publishers/google/models/veo-3.1-lite-generate-001/operations/abc"}

    class FakeClient:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            assert ":predictLongRunning" in url
            return FakeResponse()

    monkeypatch.setattr(media_server.httpx, "Client", FakeClient)
    monkeypatch.setattr(media_server, "_token", lambda: "t")
    monkeypatch.setattr(media_server, "_project", lambda: "p")

    body = json.loads(media_server._start_video("a walk through the office", "draft", 6))
    assert body["started"] is True
    assert body["operation"].endswith("/operations/abc")
    assert "content" not in body


def test_poll_says_not_done_without_bytes(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {"done": False}

    class FakeClient:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            assert ":fetchPredictOperation" in url
            return FakeResponse()

    monkeypatch.setattr(media_server.httpx, "Client", FakeClient)
    monkeypatch.setattr(media_server, "_token", lambda: "t")
    monkeypatch.setattr(media_server, "_project", lambda: "p")

    body = json.loads(
        media_server._poll_video(
            "projects/p/locations/global/publishers/google/models/veo-3.1-lite-generate-001/operations/abc"
        )
    )
    assert body["done"] is False
    assert "content" not in body
