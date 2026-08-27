"""Model access, behind an interface.

Two implementations:

  FakeProvider    deterministic, no credentials, used by tests and local runs
  VertexProvider  the real thing, via ADC against the `global` endpoint

Everything above this file is provider-agnostic, so the graph can be exercised
and asserted on without a GCP project.
"""

from __future__ import annotations

import json
import os
import time
from typing import Iterator, Protocol


class ModelProvider(Protocol):
    def structured(self, system: str, user: str, schema_hint: str) -> dict: ...

    # `stream` is deliberately NOT part of the protocol. A provider that cannot
    # stream is still a valid provider, and `iter_text` below degrades for it —
    # which is what keeps one-line test stubs working unchanged.


def iter_text(
    provider: ModelProvider, system: str, user: str, schema_hint: str
) -> Iterator[str]:
    """Text deltas from a provider, streaming if it can and in one piece if not.

    The degraded path is honest rather than theatrical: a provider with no
    streaming yields the whole document as a single chunk, so the plan arrives
    all at once. It does not fake progress by slicing a finished answer, which
    would show a user a timeline that never happened.
    """
    stream = getattr(provider, "stream", None)
    if callable(stream):
        yield from stream(system, user, schema_hint)
        return
    yield json.dumps(provider.structured(system, user, schema_hint))


class FakeProvider:
    """Deterministic stand-in.

    Ambiguity is decided by a simple, inspectable rule rather than a model, so
    tests assert the *graph's* behaviour without asserting on model output.
    """

    VAGUE = ("something", "anything", "whatever", "some stuff", "help me out")

    #: Phrases that mark a request as turning on facts to look up rather than on
    #: the user's own context. A real model judges this; the fake uses a rule so
    #: tests assert the *graph's* routing rather than a model's opinion.
    RESEARCHY = ("research", "evidence", "literature", "compare", "find out")

    #: How the graph introduces a finding into the second pass. Seeing it means
    #: this call is the informed plan, so the steps differ -- which is what makes
    #: "the research changed the plan" observable rather than asserted.
    FINDING_MARKER = "A research cell investigated this and found:"

    #: Words that make a request side-effecting, and what they would do. A real
    #: model judges this; the fake uses a rule so tests assert the *gate's*
    #: behaviour rather than a model's opinion of what counts as risky.
    ACTIONS = (
        ("delete", "delete_data"),
        ("pay", "make_payment"),
        ("invoice", "make_payment"),
        ("email", "send_external"),
        ("send", "send_external"),
        ("schedule", "create_task"),
    )

    #: Deltas a real model produces are ragged, so the fake's are too. Chunking
    #: on a fixed width would let a bug that only appears when a value straddles
    #: a chunk boundary hide behind a tidy split.
    CHUNK_WIDTHS = (7, 3, 19, 1, 11, 5, 29, 2, 13)

    def stream(self, system: str, user: str, schema_hint: str) -> Iterator[str]:
        # A latency simulator, off by default. The fake answers in about two
        # milliseconds, which is too fast to see a plan panel fill in -- the
        # same reason browsers ship network throttling. It slows delivery of a
        # real answer; it never invents progress that did not happen, and it
        # cannot engage in a deployed service because FakeProvider is not used
        # there.
        delay = float(os.environ.get("FAKE_STREAM_DELAY_MS", "0")) / 1000
        text = json.dumps(self.structured(system, user, schema_hint))
        i = 0
        for width in _cycle(self.CHUNK_WIDTHS):
            if i >= len(text):
                return
            if delay:
                time.sleep(delay)
            yield text[i : i + width]
            i += width

    def structured(self, system: str, user: str, schema_hint: str) -> dict:
        lowered = user.lower()

        if self.FINDING_MARKER in system:
            # The second, informed pass. The gate has already ruled, so there is
            # no decision to make here -- only a plan that reflects the finding.
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {"label": "Read the finding and mark what is settled", "action": ""},
                    {"label": f"Decide the open question in: {user.strip()[:44]}", "action": ""},
                    {"label": "Draft the recommendation", "action": "draft"},
                    {"label": "Review together", "action": ""},
                ],
                "note": "Planned from the research finding.",
            }

        too_vague = len(lowered.split()) < 4 or any(v in lowered for v in self.VAGUE)

        if too_vague:
            return {
                "decision": "clarify",
                "needsResearch": False,
                "question": "Before I start — what should this cover, and who is it for?",
                "options": ["Just a rough draft", "Something I can send"],
            }

        researchy = any(word in lowered for word in self.RESEARCHY)
        act = next((a for word, a in self.ACTIONS if word in lowered), "")

        steps = [
            {"label": f"Scope: {user.strip()[:60]}", "action": ""},
            {"label": "Draft the first pass", "action": "draft"},
            {"label": "Check it against what you have done before", "action": ""},
        ]
        # A request that asks for something to leave the account produces a step
        # that says so, which is what the confirm gate reads.
        steps.append(
            {"label": f"Carry it out: {user.strip()[:44]}", "action": act}
            if act
            else {"label": "Review together", "action": ""}
        )

        # Cite the first retrieved chunk so the closing payload can be asserted
        # without Vertex. The real model chooses; grounding still checks.
        citations = []
        if "Passages retrieved from the user's own documents" in system:
            for line in system.splitlines():
                if line.startswith("[") and "]" in line:
                    chunk_id = line[1 : line.index("]")]
                    if chunk_id:
                        citations.append({"chunkId": chunk_id})
                    break

        return {
            "decision": "plan",
            "needsResearch": researchy,
            "topic": user.strip() if researchy else "",
            "steps": steps,
            "note": "I will stop before anything leaves your account.",
            "citations": citations,
        }


class VertexProvider:
    """Vertex AI via Application Default Credentials.

    Constructed lazily so importing this module never requires the SDK or
    credentials to be present.
    """

    def __init__(self, project: str, location: str, model: str) -> None:
        self.project, self.location, self.model = project, location, model
        self._client = None

    def _client_or_init(self):
        if self._client is None:
            from google import genai  # imported here so the dep stays optional

            self._client = genai.Client(
                vertexai=True, project=self.project, location=self.location
            )
        return self._client

    def structured(self, system: str, user: str, schema_hint: str) -> dict:
        client = self._client_or_init()
        response = client.models.generate_content(
            model=self.model,
            contents=f"{system}\n\nSchema: {schema_hint}\n\nUser: {user}",
            config={"response_mime_type": "application/json"},
        )
        return json.loads(response.text)

    def stream(self, system: str, user: str, schema_hint: str) -> Iterator[str]:
        client = self._client_or_init()
        for chunk in client.models.generate_content_stream(
            model=self.model,
            contents=f"{system}\n\nSchema: {schema_hint}\n\nUser: {user}",
            config={"response_mime_type": "application/json"},
        ):
            # A chunk can carry no text (a safety verdict, a usage-only frame).
            if chunk.text:
                yield chunk.text


def _cycle(values: tuple[int, ...]) -> Iterator[int]:
    while True:
        yield from values


def create_provider() -> ModelProvider:
    """Fake unless a project is configured. Never silently half-real."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    use_vertex = os.environ.get("USE_VERTEX") == "true"

    if use_vertex and project:
        return VertexProvider(
            project=project,
            # `global` is where current Gemini Flash models are reachable, and is
            # independent of the Cloud Run region.
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
            model=os.environ.get("GEMINI_MODEL", "gemini-3.7-flash"),
        )
    return FakeProvider()
