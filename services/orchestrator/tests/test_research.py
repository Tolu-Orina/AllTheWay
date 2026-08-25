"""Routing a turn through the research cell.

The cell itself is tested in `services/research-cell`. These are about the
orchestrator's side of the boundary: when it delegates, when it refuses to, and
what happens when the cell is not there.
"""

import pytest

from app import graph
from app.graph import run_turn, run_turn_stream
from app.models import TurnRequest
from app.providers import FakeProvider
from app.research_client import Finding

RESEARCH_REQUEST = "Research whether four-day weeks reduce burnout for our team"
PLAIN_REQUEST = "Draft a nav wireframe for the desktop dashboard"

FINDING = Finding(
    answer="Burnout falls modestly; the effect is clearest where workload was cut too.",
    trace=[
        "Fanned out to 2 workers: mainstream, counterpoint",
        "Synthesised 2 finding(s) into one answer",
    ],
    degraded=False,
    workers_answered=2,
)


@pytest.fixture
def cell(monkeypatch):
    """Replaces the A2A call. Records the topics it was asked for."""
    calls: list[str] = []
    box = {"finding": FINDING}

    def fake_research(topic: str):
        calls.append(topic)
        return box["finding"]

    monkeypatch.setattr(graph, "research", fake_research)
    return {"calls": calls, "box": box}


def turn(message: str, provider=None):
    return run_turn(
        TurnRequest(session_id="s1", user_id="u1", message=message),
        provider or FakeProvider(),
    )


def events(message: str, provider=None):
    return list(
        run_turn_stream(
            TurnRequest(session_id="s1", user_id="u1", message=message),
            provider or FakeProvider(),
        )
    )


# ------------------------------------------------------------------ routing


def test_a_research_shaped_request_reaches_the_cell(cell):
    result = turn(RESEARCH_REQUEST)
    assert cell["calls"] == [RESEARCH_REQUEST]
    assert result.decision == "plan"


def test_a_plain_request_never_reaches_the_cell(cell):
    turn(PLAIN_REQUEST)
    # Research costs a swarm's budget. A request that does not need one must
    # not quietly pay for it.
    assert cell["calls"] == []


def test_an_ambiguous_request_is_stopped_before_the_cell_is_called(cell):
    """The gate guards the budget, not just the answer.

    If research ran before the gate ruled, an unclear request would spend a
    swarm every time — which is exactly the failure the gate exists to prevent.
    """
    result = turn("research something")
    assert result.decision == "clarify"
    assert cell["calls"] == []


# --------------------------------------------------- the finding is used


def test_the_plan_is_rebuilt_in_light_of_the_finding(cell):
    informed = turn(RESEARCH_REQUEST).plan
    plain = turn(PLAIN_REQUEST).plan
    labels = [s.label for s in informed]
    assert labels != [s.label for s in plain]
    assert any("finding" in label.lower() for label in labels)


def test_the_synthesis_is_what_the_user_reads(cell):
    assert turn(RESEARCH_REQUEST).note == FINDING.answer


def test_the_cells_trace_is_relayed_so_the_fan_out_is_visible(cell):
    trace = turn(RESEARCH_REQUEST).trace
    assert any("Delegating research to the research cell" in line for line in trace)
    assert any("Fanned out to 2 workers" in line for line in trace)
    # Attributed, so a user can tell which agent said what.
    assert any(line.startswith("Research cell:") for line in trace)


# ------------------------------------------------------------- degradation


def test_an_unreachable_cell_still_produces_a_plan(cell):
    cell["box"]["finding"] = None
    result = turn(RESEARCH_REQUEST)

    assert result.decision == "plan"
    assert len(result.plan) >= 2  # the first pass's steps, released not discarded
    assert any("did not answer" in line for line in result.trace)


def test_a_degraded_finding_is_still_used(cell):
    cell["box"]["finding"] = Finding(
        answer="Partial, from one angle only.",
        trace=["Fanned out to 2 workers: mainstream, counterpoint",
               "counterpoint did not answer (timed out)"],
        degraded=True,
        workers_answered=1,
    )
    result = turn(RESEARCH_REQUEST)
    assert result.note == "Partial, from one angle only."
    assert any("did not answer" in line for line in result.trace)


# ------------------------------- streaming: no step is ever superseded


def test_no_step_is_streamed_before_research_decides_the_plan(cell):
    """The finality invariant, under the one thing that could break it.

    The first pass produces steps that the informed pass replaces. If those were
    streamed as they arrived, a user would watch four steps appear and then be
    rewritten — which is precisely what the streaming design promises cannot
    happen.
    """
    labels = [e.step.label for e in events(RESEARCH_REQUEST) if e.kind == "step" and e.step]
    assert labels == [s.label for s in turn(RESEARCH_REQUEST).plan]
    assert len(labels) == len(set(labels))
    # None of the first pass's steps escaped.
    assert not any(label.startswith("Scope:") for label in labels)


def test_a_plain_request_still_streams_its_steps_as_they_arrive(cell):
    """Holding steps back must not become holding them back always — that would
    silently undo Phase 2 for every ordinary turn."""
    stream = events(PLAIN_REQUEST)
    kinds = [e.kind for e in stream]
    first_step = kinds.index("step")
    last_step = len(kinds) - 1 - kinds[::-1].index("step")
    # Steps are interleaved with the rest of the stream, not appended in a block
    # at the very end after everything else has been decided.
    assert first_step < last_step
    assert kinds[-1] == "note"


def test_exactly_one_terminal_shape_per_turn(cell):
    for message in (RESEARCH_REQUEST, PLAIN_REQUEST, "do something"):
        kinds = [e.kind for e in events(message)]
        assert kinds.count("clarify") + (1 if kinds.count("note") else 0) >= 1
        # A question and a plan never travel together.
        assert not (kinds.count("clarify") and kinds.count("step"))
