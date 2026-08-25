"""The A2A boundary: the card is a contract, and one artifact is a safety rule.

`test_cell.py` covers the swarm's bounds. These cover what the protocol layer
exposes — which is the other place FR-10 could be broken, by an executor that
helpfully attaches the raw findings "for debugging".
"""

import asyncio

from a2a.types import Message, Part, Role, TaskState
from google.protobuf import json_format

from app.a2a_card import BEARER_SCHEME, build_agent_card
from app.a2a_executor import ResearchExecutor
from app.budget import Budget
from app.cell import ANGLES
from app.providers import Completion, FakeProvider

TOPIC = "whether four-day weeks reduce burnout"


# --------------------------------------------------------------------- card


def test_card_declares_a_reachable_jsonrpc_interface():
    card = build_agent_card("https://research.example")
    interfaces = list(card.supported_interfaces)
    assert len(interfaces) == 1
    assert interfaces[0].url == "https://research.example"
    assert interfaces[0].protocol_binding == "JSONRPC"


def test_card_exposes_exactly_one_skill():
    # The card is the outer boundary of what this service can be asked to do.
    # A second skill is how a worker-addressing back door would arrive.
    skills = list(build_agent_card().skills)
    assert [s.id for s in skills] == ["research_topic"]


def test_card_publishes_the_bounds_it_actually_enforces():
    """A caller decides whether to use us from the card, so the numbers on it
    must be the numbers in `Budget` — not a prose approximation that drifts."""
    budget = Budget()
    description = list(build_agent_card().skills)[0].description
    assert f"{budget.workers} workers" in description
    assert f"{budget.total_output_tokens} output tokens" in description
    assert f"{budget.wall_clock_s:g}s wall clock" in description


def test_card_requires_bearer_auth_and_no_api_key():
    card = build_agent_card()
    assert BEARER_SCHEME in card.security_schemes
    assert card.security_schemes[BEARER_SCHEME].WhichOneof("scheme") == "http_auth_security_scheme"
    assert all(
        s.WhichOneof("scheme") != "api_key_security_scheme"
        for s in card.security_schemes.values()
    )


# ----------------------------------------------------------------- executor


class RecordingQueue:
    def __init__(self) -> None:
        self.events: list = []

    async def enqueue_event(self, event) -> None:
        self.events.append(event)


class Ctx:
    """Minimal RequestContext stand-in — only what the executor reads."""

    def __init__(self, text: str) -> None:
        self.task_id = "task-1"
        self.context_id = "ctx-1"
        self.tenant = "orchestrator"
        self.current_task = None
        self._text = text
        self.message = Message(message_id="m1", role=Role.ROLE_USER, parts=[Part(text=text)])

    def get_user_input(self) -> str:
        return self._text


def run(text: str = TOPIC, provider=None) -> RecordingQueue:
    queue = RecordingQueue()
    executor = ResearchExecutor(provider or FakeProvider(), Budget())
    asyncio.run(executor.execute(Ctx(text), queue))
    return queue


def states(queue: RecordingQueue) -> list:
    return [e.status.state for e in queue.events if hasattr(e, "status")]


def artifacts(queue: RecordingQueue) -> list:
    return [e for e in queue.events if hasattr(e, "artifact")]


def payloads(queue: RecordingQueue) -> list[dict]:
    return [
        json_format.MessageToDict(p.data)
        for e in artifacts(queue)
        for p in e.artifact.parts
        if p.WhichOneof("content") == "data"
    ]


def status_texts(queue: RecordingQueue) -> list[str]:
    out = []
    for event in queue.events:
        status = getattr(event, "status", None)
        if status is None or not status.HasField("message"):
            continue
        out.extend(p.text for p in status.message.parts if p.WhichOneof("content") == "text")
    return out


def test_task_is_enqueued_before_any_status_update():
    assert type(run().events[0]).__name__ == "Task"


def test_a_run_completes_with_exactly_one_artifact():
    """The protocol half of FR-10.

    Not "the artifact contains no worker text" — there is only one artifact, so
    there is nowhere to put worker text even if someone wanted to.
    """
    queue = run()
    assert TaskState.TASK_STATE_COMPLETED in states(queue)
    assert len(artifacts(queue)) == 1
    assert artifacts(queue)[0].artifact.name == "answer"
    assert artifacts(queue)[0].last_chunk is True


def test_the_artifact_carries_an_answer_and_a_trace():
    payload = payloads(run())[0]
    assert payload["answer"]
    assert any("Fanned out" in line for line in payload["trace"])
    assert payload["workersStarted"] == len(ANGLES)


def test_the_fan_out_is_narrated_before_the_task_finishes():
    queue = run()
    texts = status_texts(queue)
    assert any("Fanned out to 2 workers" in t for t in texts), texts

    narration = max(
        i
        for i, e in enumerate(queue.events)
        if hasattr(e, "status") and e.status.state == TaskState.TASK_STATE_WORKING
    )
    finished = max(
        i
        for i, e in enumerate(queue.events)
        if hasattr(e, "status") and e.status.state == TaskState.TASK_STATE_COMPLETED
    )
    assert narration < finished


def test_no_worker_text_appears_anywhere_on_the_wire():
    """Neither in the artifact nor in the progress narration."""

    class Marked:
        def generate(self, system, user, max_output_tokens):
            if system.startswith("ANGLE: synthesis"):
                return Completion(text="a clean synthesised answer", output_tokens=4)
            return Completion(text="WORKER-ONLY-SECRET", output_tokens=2)

    queue = run(provider=Marked())
    everything = str(payloads(queue)) + " ".join(status_texts(queue))
    assert "WORKER-ONLY-SECRET" not in everything


def test_a_degraded_run_still_completes():
    """Losing a worker is not a task failure — the caller got a usable answer."""

    class OneFails:
        def generate(self, system, user, max_output_tokens):
            if system.startswith("ANGLE: counterpoint"):
                raise RuntimeError("worker died")
            return Completion(text="a finding", output_tokens=3)

    queue = run(provider=OneFails())
    assert TaskState.TASK_STATE_COMPLETED in states(queue)
    assert TaskState.TASK_STATE_FAILED not in states(queue)

    payload = payloads(queue)[0]
    assert payload["degraded"] is True
    assert payload["workersAnswered"] == 1
    # The caller must be able to tell it got less breadth than intended.
    assert payload["answer"]


def test_an_empty_topic_fails_rather_than_researching_nothing():
    assert TaskState.TASK_STATE_FAILED in states(run("   "))


def test_every_run_reaches_exactly_one_terminal_state():
    terminal = {
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_REJECTED,
        TaskState.TASK_STATE_INPUT_REQUIRED,
    }
    assert len([s for s in states(run()) if s in terminal]) == 1
