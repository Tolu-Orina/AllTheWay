"""Model access for the research cell.

Deliberately a different interface from the orchestrator's `ModelProvider`. That
one returns structured JSON for a plan; this one returns prose with a hard
output cap, because the cap is the point:

    generate(..., max_output_tokens=N)

`max_output_tokens` is passed to the model API, so the bound is applied by the
provider rather than asked for in a prompt. That is what makes the token budget
in `budget.py` an actual limit.

Two implementations, matching the rest of the repo: a deterministic fake that
needs no credentials, and Vertex via ADC.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Protocol

from .ground import WebSource, chunks_from_response


@dataclass(frozen=True)
class Completion:
    text: str
    #: What the call actually cost. Booked to the ledger by the caller.
    output_tokens: int


class ResearchProvider(Protocol):
    def generate(self, system: str, user: str, max_output_tokens: int) -> Completion: ...

    def grounded_lookup(self, topic: str, max_output_tokens: int) -> tuple[str, list[WebSource]]:
        """One Vertex Google Search. Empty sources means it did not look anything up."""
        ...


class FakeProvider:
    """Deterministic stand-in, so the whole cell runs and is asserted on with
    no GCP project.

    It also carries the fault injection used to verify degradation. A swarm that
    keeps working when a worker dies is a claim, and a claim about failure can
    only be checked by causing the failure -- so there has to be a way to cause
    it in a running service, not only in a unit test with a stub.
    """

    #: Names a worker angle that should fail, or "synthesis". Dev-only: this
    #: provider is never constructed in a deployed service.
    FAIL_ENV = "FAKE_RESEARCH_FAIL"
    #: Makes a worker hang, to exercise the wall-clock deadline rather than the
    #: exception path. Seconds.
    HANG_ENV = "FAKE_RESEARCH_HANG_S"

    def generate(self, system: str, user: str, max_output_tokens: int) -> Completion:
        label = _label_of(system)

        if os.environ.get(self.FAIL_ENV) == label:
            raise RuntimeError(f"injected failure in {label}")

        if os.environ.get(f"{self.HANG_ENV}_{label.upper()}"):
            time.sleep(float(os.environ[f"{self.HANG_ENV}_{label.upper()}"]))

        text = _fake_text(label, user)
        # A word is a serviceable stand-in for a token here; the fake exists to
        # exercise the accounting, not to model a real tokeniser.
        words = text.split()
        capped = " ".join(words[:max_output_tokens])
        return Completion(text=capped, output_tokens=min(len(words), max_output_tokens))

    def grounded_lookup(self, topic: str, max_output_tokens: int) -> tuple[str, list[WebSource]]:
        del topic, max_output_tokens
        return "", []


def _topic_of(user: str) -> str:
    """The topic, whether the prompt is a bare topic or a synthesis brief."""
    for line in user.splitlines():
        if line.startswith("Topic:"):
            return line.removeprefix("Topic:").strip()[:80]
    return user.strip()[:80]


def _label_of(system: str) -> str:
    """The angle name the cell put at the front of the system prompt."""
    first = system.strip().splitlines()[0] if system.strip() else ""
    return first.removeprefix("ANGLE:").strip().lower() or "unknown"


def _fake_text(label: str, user: str) -> str:
    topic = _topic_of(user)
    if label == "synthesis":
        # Deliberately does NOT echo its input. The synthesis prompt contains
        # every worker's finding, so a fake that parrots its input republishes
        # worker text through the one channel that is allowed to leave the cell
        # -- making a real FR-10 question look answered when it is not.
        return (
            f"On {topic}: the effect is real but modest, and clearest where workload "
            "was reduced alongside hours. Decide the substance now; revisit timing "
            "once the first result is in."
        )
    if label == "counterpoint":
        return (
            f"Against the obvious reading of {topic}: the strongest objection is that "
            "the effect reported is small and measured over a short window."
        )
    return (
        f"On {topic}: the mainstream position is well supported and reproduced across "
        "several independent settings."
    )


class VertexProvider:
    """Vertex AI via Application Default Credentials.

    Constructed lazily so importing this module never requires the SDK or
    credentials to be present.
    """

    def __init__(
        self, project: str, location: str, model: str, request_timeout_s: float
    ) -> None:
        self.project, self.location, self.model = project, location, model
        # The bound that actually stops a hung call. The cell's wall clock stops
        # *waiting* on a worker, but cannot kill its thread -- so without this a
        # stalled request would hold a pool slot indefinitely. See cell.py.
        self.request_timeout_s = request_timeout_s
        self._client = None

    def _client_or_init(self):
        if self._client is None:
            from google import genai  # imported here so the dep stays optional

            self._client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location,
                # milliseconds, per the genai client contract
                http_options={"timeout": int(self.request_timeout_s * 1000)},
            )
        return self._client

    def generate(self, system: str, user: str, max_output_tokens: int) -> Completion:
        client = self._client_or_init()
        response = client.models.generate_content(
            model=self.model,
            contents=user,
            config={
                "system_instruction": system,
                # The cap that makes the budget real. Enforced by the API.
                "max_output_tokens": max_output_tokens,
            },
        )
        usage = getattr(response, "usage_metadata", None)
        # Fall back to the cap rather than to zero: booking zero for a call whose
        # cost is unknown would let an unmeasured run spend without limit.
        spent = getattr(usage, "candidates_token_count", None) or max_output_tokens
        return Completion(text=response.text or "", output_tokens=int(spent))

    def grounded_lookup(self, topic: str, max_output_tokens: int) -> tuple[str, list[WebSource]]:
        client = self._client_or_init()
        response = client.models.generate_content(
            model=self.model,
            contents=topic,
            config={
                "system_instruction": (
                    "Answer in a few short sentences. Use only the web results. "
                    "Never invent a source or a URL."
                ),
                "max_output_tokens": max_output_tokens,
                "tools": [{"google_search": {}}],
            },
        )
        usage = getattr(response, "usage_metadata", None)
        spent = getattr(usage, "candidates_token_count", None) or max_output_tokens
        del spent
        sources = chunks_from_response(response)
        return (response.text or "").strip(), sources


def create_provider() -> ResearchProvider:
    """Fake unless a project is configured. Never silently half-real."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if os.environ.get("USE_VERTEX") == "true" and project:
        return VertexProvider(
            project=project,
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
            model=os.environ.get("GEMINI_MODEL", "gemini-3.7-flash"),
            # Comfortably inside the run's wall clock, so a call that is going to
            # be abandoned gives up on its own shortly after.
            request_timeout_s=float(os.environ.get("RESEARCH_REQUEST_TIMEOUT_S", "25")),
        )
    return FakeProvider()
