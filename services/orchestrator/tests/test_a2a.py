"""A2A layer: the card is a contract, and the task states carry the gate.

These assert the protocol mapping, not the graph. `test_graph.py` remains the
regression suite for the graph itself, which this phase did not touch.
"""

import asyncio

import pytest
from a2a.types import Message, Part, Role, TaskState
from google.protobuf import json_format, struct_pb2

from app.a2a_card import BEARER_SCHEME, build_agent_card
from app.a2a_executor import PASSAGES_KEY, PREFERENCES_KEY, OrchestratorExecutor
from app.providers import FakeProvider


# --------------------------------------------------------------------------- card


def test_card_declares_a_reachable_jsonrpc_interface():
    card = build_agent_card("https://orchestrator.example")
    assert card.name
    assert card.version
    interfaces = list(card.supported_interfaces)
    assert len(interfaces) == 1
    assert interfaces[0].url == "https://orchestrator.example"
    assert interfaces[0].protocol_binding == "JSONRPC"
    assert interfaces[0].protocol_version == "1.0"


def test_card_claims_streaming_only_because_it_is_now_real():
    # Flipped in Phase 2, once the executor actually emits incremental events.
    # The guard against a false promise is the streaming tests below, not this
    # assertion — this one only stops the flag drifting back.
    assert build_agent_card().capabilities.streaming is True


def test_card_exposes_one_skill_because_clarify_is_a_state_not_a_skill():
    skills = list(build_agent_card().skills)
    assert [s.id for s in skills] == ["plan_session"]


def test_card_requires_bearer_auth_and_no_api_key():
    card = build_agent_card()
    assert BEARER_SCHEME in card.security_schemes
    scheme = card.security_schemes[BEARER_SCHEME]
    assert scheme.WhichOneof("scheme") == "http_auth_security_scheme"
    assert scheme.http_auth_security_scheme.scheme == "bearer"
    # An API key would be the first stealable secret in this architecture.
    assert all(
        s.WhichOneof("scheme") != "api_key_security_scheme"
        for s in card.security_schemes.values()
    )
    assert any(BEARER_SCHEME in r.schemes for r in card.security_requirements)


def test_card_serialises_to_spec_shaped_json():
    payload = json_format.MessageToDict(build_agent_card())
    # protobuf JSON mapping is camelCase, which is what the spec expects.
    for key in ("supportedInterfaces", "defaultInputModes", "securitySchemes"):
        assert key in payload


# ----------------------------------------------------------------------- executor


class RecordingQueue:
    """Stands in for an EventQueue, keeping every event for assertion."""

    def __init__(self) -> None:
        self.events: list = []

    async def enqueue_event(self, event) -> None:
        self.events.append(event)


class Ctx:
    """Minimal RequestContext stand-in — only what the executor reads."""

    def __init__(
        self,
        text: str,
        preferences: list[str] | None = None,
        passages: list[dict] | None = None,
    ) -> None:
        self.task_id = "task-1"
        self.context_id = "ctx-1"
        self.tenant = "user-1"
        self.current_task = None
        self._text = text
        self.message = Message(
            message_id="m1", role=Role.ROLE_USER, parts=[Part(text=text)]
        )
        meta: dict = {}
        if preferences is not None:
            meta[PREFERENCES_KEY] = preferences
        if passages is not None:
            meta[PASSAGES_KEY] = passages
        if meta:
            metadata = struct_pb2.Struct()
            json_format.ParseDict(meta, metadata)
            self.message.metadata.CopyFrom(metadata)

    def get_user_input(self) -> str:
        return self._text


def run(
    text: str,
    preferences: list[str] | None = None,
    passages: list[dict] | None = None,
) -> RecordingQueue:
    queue = RecordingQueue()
    executor = OrchestratorExecutor(FakeProvider())
    asyncio.run(executor.execute(Ctx(text, preferences, passages), queue))
    return queue


def states(queue: RecordingQueue) -> list:
    return [e.status.state for e in queue.events if hasattr(e, "status")]


def artifact_names(queue: RecordingQueue) -> list[str]:
    return [e.artifact.name for e in queue.events if hasattr(e, "artifact")]


def test_task_is_enqueued_before_any_status_update():
    # Emitting a status first is rejected by the framework as
    # INVALID_AGENT_RESPONSE. This ordering is load-bearing, not incidental.
    queue = run("Draft a nav wireframe for the desktop dashboard")
    assert type(queue.events[0]).__name__ == "Task"


def test_ambiguous_request_ends_in_input_required_with_no_plan():
    queue = run("do something")
    assert TaskState.TASK_STATE_INPUT_REQUIRED in states(queue)
    assert TaskState.TASK_STATE_COMPLETED not in states(queue)
    assert "plan" not in artifact_names(queue)
    assert "clarification" in artifact_names(queue)


def test_clear_request_completes_with_a_plan_artifact():
    queue = run("Draft a nav wireframe for the desktop dashboard")
    assert TaskState.TASK_STATE_COMPLETED in states(queue)
    assert "plan" in artifact_names(queue)


def test_trace_is_emitted_on_both_outcomes():
    for text in ("do something", "Draft a nav wireframe for the desktop dashboard"):
        queue = run(text)
        payloads = [
            json_format.MessageToDict(p.data)
            for e in queue.events
            if hasattr(e, "artifact")
            for p in e.artifact.parts
            if p.WhichOneof("content") == "data"
        ]
        assert any("trace" in p for p in payloads), text


def test_preferences_arrive_by_metadata_and_never_reach_the_plan_text():
    queue = run(
        "Draft a nav wireframe for the desktop dashboard",
        preferences=["Collapse navigation rather than extend it"],
    )
    payloads = [
        json_format.MessageToDict(p.data)
        for e in queue.events
        if hasattr(e, "artifact")
        for p in e.artifact.parts
        if p.WhichOneof("content") == "data"
    ]
    trace = next(p["trace"] for p in payloads if "trace" in p)
    assert any("learned preference" in line for line in trace)

    labels = [p["step"]["label"] for p in payloads if "step" in p]
    assert labels
    # Preferences are context, not something the user said. Leaking them into
    # the echoed request is the shape prompt injection takes.
    assert all("Collapse navigation" not in label for label in labels)


def test_citations_on_the_closing_artifact_carry_the_retrieved_passage():
    # The chip opens this text. Re-querying by uid would be a second path, and
    # a path that can open another user's chunk.
    passage = {
        "chunkId": "c1",
        "documentId": "d1",
        "title": "Supply agreement",
        "page": 12,
        "text": "The indemnity is capped at two million pounds.",
    }
    queue = run(
        "What does the supply agreement say about indemnity caps",
        passages=[passage],
    )
    payloads = [
        json_format.MessageToDict(p.data)
        for e in queue.events
        if hasattr(e, "artifact")
        for p in e.artifact.parts
        if p.WhichOneof("content") == "data"
    ]
    closing = next(p for p in payloads if "note" in p)
    citations = closing["citations"]
    assert len(citations) == 1
    assert citations[0]["chunkId"] == "c1"
    assert citations[0]["documentId"] == "d1"
    assert citations[0]["text"] == passage["text"]
    assert "uid" not in citations[0]
    assert "userId" not in citations[0]
    assert closing["grounded"] is True


def test_citation_wire_is_a_named_function_and_carries_no_uid():
    from app.a2a_executor import _citation_wire
    from app.models import Citation

    payload = _citation_wire(
        Citation(chunk_id="c1", document_id="d1", page=2, title="T", text="body")
    )
    assert payload["documentId"] == "d1"
    assert payload["chunkId"] == "c1"
    assert payload["kind"] == "document"
    assert payload["url"] == ""
    assert "uid" not in payload


def test_a_web_citation_carries_the_url_that_came_back():
    from app.a2a_executor import _citation_wire
    from app.models import Citation

    payload = _citation_wire(
        Citation(
            chunk_id="web:https://www.metoffice.gov.uk/x",
            document_id="",
            page=0,
            title="Met Office",
            text="https://www.metoffice.gov.uk/x",
            kind="web",
            url="https://www.metoffice.gov.uk/x",
        )
    )
    assert payload["kind"] == "web"
    assert payload["url"].startswith("https://")
    assert "uid" not in payload



def test_provider_failure_becomes_a_failed_task_not_an_exception():
    class Exploding:
        def structured(self, system, user, schema_hint):
            raise RuntimeError("model unavailable")

    queue = RecordingQueue()
    asyncio.run(OrchestratorExecutor(Exploding()).execute(Ctx("Draft a wireframe now"), queue))
    assert TaskState.TASK_STATE_FAILED in states(queue)


@pytest.mark.parametrize("text", ["do something", "Draft a nav wireframe for the dashboard"])
def test_every_run_reaches_exactly_one_terminal_state(text):
    terminal = {
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_REJECTED,
        TaskState.TASK_STATE_INPUT_REQUIRED,
    }
    reached = [s for s in states(run(text)) if s in terminal]
    assert len(reached) == 1


# ---------------------------------------------------------------------- streaming


def artifact_events(queue: RecordingQueue) -> list:
    return [e for e in queue.events if hasattr(e, "artifact")]


def step_labels(queue: RecordingQueue) -> list[str]:
    labels = []
    for event in artifact_events(queue):
        for part in event.artifact.parts:
            if part.WhichOneof("content") == "data":
                payload = json_format.MessageToDict(part.data)
                if "step" in payload:
                    labels.append(payload["step"]["label"])
    return labels


CLEAR = "Draft a nav wireframe for the desktop dashboard"


def test_each_plan_step_arrives_as_its_own_event_rather_than_one_dump():
    # This is the whole point of the phase: the panel fills in, and it can only
    # fill in if the steps are separate events.
    queue = run(CLEAR)
    per_step = [e for e in artifact_events(queue) if step_labels_of(e)]
    assert len(per_step) >= 2


def step_labels_of(event) -> list[str]:
    return [
        json_format.MessageToDict(p.data)["step"]["label"]
        for p in event.artifact.parts
        if p.WhichOneof("content") == "data"
        and "step" in json_format.MessageToDict(p.data)
    ]


def test_chunks_use_append_semantics_so_they_form_one_artifact():
    queue = run(CLEAR)
    plan_events = [e for e in artifact_events(queue) if e.artifact.name == "plan"]
    assert len(plan_events) >= 2
    # One artifact id throughout, or the client sees N one-part artifacts.
    assert len({e.artifact.artifact_id for e in plan_events}) == 1
    # The first chunk creates, the rest extend.
    assert plan_events[0].append is False
    assert all(e.append for e in plan_events[1:])
    # Exactly one end, and it is the end.
    assert [e.last_chunk for e in plan_events].count(True) == 1
    assert plan_events[-1].last_chunk is True


def test_progress_is_reported_before_the_task_finishes():
    queue = run(CLEAR)
    kinds = [type(e).__name__ for e in queue.events]
    working = [
        i
        for i, e in enumerate(queue.events)
        if hasattr(e, "status") and e.status.state == TaskState.TASK_STATE_WORKING
    ]
    first_step = min(
        i for i, e in enumerate(queue.events) if hasattr(e, "artifact") and step_labels_of(e)
    )
    terminal = max(
        i
        for i, e in enumerate(queue.events)
        if hasattr(e, "status") and e.status.state == TaskState.TASK_STATE_COMPLETED
    )
    assert working, kinds
    # Trace narration and steps both land before the task is done — otherwise
    # "streaming" would just be a batch delivered down a long pipe.
    assert min(working) < terminal
    assert first_step < terminal


def test_a_step_is_never_emitted_twice():
    # The finality invariant, at the protocol layer. If a partially-arrived
    # label ever escaped, it would show up here as a duplicate or a prefix.
    labels = step_labels(run(CLEAR))
    assert len(labels) == len(set(labels))


def test_the_gate_stops_steps_from_streaming_at_all():
    # Not "the steps are discarded" — they are never emitted. An ambiguous
    # request must not put a single plan line in front of the user.
    assert step_labels(run("do something")) == []


def test_a_non_streaming_client_assembles_the_same_plan():
    """Folding the events the way a task store does must rebuild one plan.

    Streaming is not allowed to be a different answer delivered differently.
    """
    queue = run(CLEAR)
    folded: dict[str, list] = {}
    for event in artifact_events(queue):
        parts = folded.setdefault(event.artifact.artifact_id, [])
        if not event.append:
            parts.clear()
        parts.extend(event.artifact.parts)

    payloads = [
        json_format.MessageToDict(p.data)
        for p in folded["plan"]
        if p.WhichOneof("content") == "data"
    ]
    assert [p["step"]["label"] for p in payloads if "step" in p] == step_labels(queue)
    # The closing part carries what the per-step parts cannot.
    assert any("trace" in p for p in payloads)


# ------------------------------------------------------- the confirm gate


CONFIRMS = "Email the Northwind proposal to Ana today"


def test_a_side_effecting_plan_ends_in_input_required_not_completed():
    """FR-V2 on the wire.

    The same protocol state as the Clarify Gate, which is the point: any
    conformant A2A client stops without knowing what AllTheWay is.
    """
    queue = run(CONFIRMS)
    assert TaskState.TASK_STATE_INPUT_REQUIRED in states(queue)
    assert TaskState.TASK_STATE_COMPLETED not in states(queue)
    assert "confirmation" in artifact_names(queue)


def test_the_confirmation_artifact_is_distinct_from_a_clarification():
    # Both end in INPUT_REQUIRED. A caller must be able to tell "I do not
    # understand you" from "I understand you, and not without a yes".
    assert "confirmation" in artifact_names(run(CONFIRMS))
    assert "clarification" in artifact_names(run("do something"))


def test_the_plan_travels_with_the_confirmation():
    # Nobody can agree to something they were not shown.
    queue = run(CONFIRMS)
    assert step_labels(queue), "the steps being approved must be on the wire"


def test_steps_carry_their_action_across_the_boundary():
    """The regression that made every step look harmless to the client.

    The gate read the graph directly and fired correctly, so the server was
    right and only the wire was wrong — which is the kind of bug that shows up
    as a UI that cannot warn anyone.
    """
    queue = run(CONFIRMS)
    actions = [
        json_format.MessageToDict(p.data)["step"].get("action", "")
        for e in artifact_events(queue)
        for p in e.artifact.parts
        if p.WhichOneof("content") == "data"
        and "step" in json_format.MessageToDict(p.data)
    ]
    assert "send_external" in actions, actions


def test_steps_carry_the_call_across_the_boundary():
    queue = run(CONFIRMS)
    calls = [
        json_format.MessageToDict(p.data)["step"]
        for e in artifact_events(queue)
        for p in e.artifact.parts
        if p.WhichOneof("content") == "data"
        and "step" in json_format.MessageToDict(p.data)
    ]
    named = [c for c in calls if c.get("connector") and c.get("tool")]
    assert named, calls
    assert any(c.get("tool") in ("create_draft", "send_email") for c in named)
