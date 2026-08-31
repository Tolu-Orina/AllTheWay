"""The swarm's bounds are the product's safety claim, so they are what is tested.

Every test here is about a bound holding under pressure, not about the quality
of an answer. A swarm that produces good text and cannot be stopped is a worse
outcome than one that produces plain text and always stops.
"""

import asyncio
import time

import pytest

from app.budget import Budget, BudgetExceeded, Ledger
from app.cell import ANGLES, ResearchResult, research
from app.providers import Completion, FakeProvider

TOPIC = "whether four-day weeks reduce burnout"


def run(topic=TOPIC, provider=None, budget=None) -> ResearchResult:
    return asyncio.run(research(topic, provider or FakeProvider(), budget))


# ------------------------------------------------------------------ the shape


def test_the_swarm_is_exactly_two_workers():
    # Not "at most" two: the architecture fixes the number, and it is fixed in
    # code rather than in a configurable field someone could raise.
    assert ANGLES == ("mainstream", "counterpoint")
    assert run().workers_started == 2


def test_a_healthy_run_answers_from_both_workers():
    result = run()
    assert result.workers_answered == 2
    assert result.degraded is False
    assert result.answer


def test_the_trace_shows_the_fan_out():
    # Required by the phase's exit criteria: a user can see that a swarm ran.
    trace = run().trace
    assert any("Fanned out to 2 workers" in line for line in trace)
    assert any("No web sources; answering from the model only" in line for line in trace)


def test_a_grounded_lookup_is_named_in_the_trace_and_on_the_result():
    from app.ground import WebSource

    class Grounded:
        def generate(self, system, user, max_output_tokens):
            return FakeProvider().generate(system, user, max_output_tokens)

        def grounded_lookup(self, topic, max_output_tokens):
            del topic, max_output_tokens
            return "Rain later.", [
                WebSource(title="Met Office", uri="https://www.metoffice.gov.uk/x")
            ]

    result = run(provider=Grounded())
    assert any("Looked this up" in line for line in result.trace)
    assert result.sources[0]["uri"] == "https://www.metoffice.gov.uk/x"


# ------------------------------------------------------- FR-10: nothing leaks


def test_the_result_type_cannot_carry_worker_output():
    """The structural half of FR-10.

    Not "we do not populate it" -- there is no field to populate. A future edit
    that tried to return a worker's text would have to change the type, which is
    a reviewable diff rather than a silent leak.
    """
    fields = set(ResearchResult.__dataclass_fields__)
    assert fields == {
        "answer",
        "trace",
        "workers_started",
        "workers_answered",
        "degraded",
        "output_tokens",
        "sources",
    }


def test_no_worker_text_reaches_the_answer_when_synthesis_fails():
    """The behavioural half of FR-10.

    The tempting degradation -- hand back the one finding we did get -- is
    exactly the leak. It must not happen even when it would be more useful.
    """

    class SynthesisFails:
        def generate(self, system, user, max_output_tokens):
            if system.startswith("ANGLE: synthesis"):
                raise RuntimeError("synthesis unavailable")
            return Completion(text="WORKER-ONLY-SECRET finding text", output_tokens=5)

    result = run(provider=SynthesisFails())
    assert result.workers_answered == 2
    assert "WORKER-ONLY-SECRET" not in result.answer
    assert result.degraded is True
    assert result.answer  # still says something a person can read


def test_the_default_fake_does_not_republish_worker_text():
    """Regression: the fake used to echo its own prompt.

    The synthesis prompt contains every finding, so a provider that parrots its
    input pushes worker text out through the one channel allowed to leave the
    cell. That made an FR-10 test pass against a hand-written stub while the
    provider everything else runs on was leaking.
    """
    answer = run().answer
    for worker_phrase in ("strongest objection", "reproduced across", "[mainstream]", "Findings:"):
        assert worker_phrase not in answer, answer


# --------------------------------------------------------------- degradation


def test_losing_one_worker_still_returns_an_answer():
    class OneFails:
        def generate(self, system, user, max_output_tokens):
            if system.startswith("ANGLE: counterpoint"):
                raise RuntimeError("worker died")
            return Completion(text="a usable finding", output_tokens=4)

    result = run(provider=OneFails())
    assert result.answer
    assert result.workers_answered == 1
    assert result.degraded is True
    assert any("counterpoint did not answer" in line for line in result.trace)


def test_losing_every_worker_returns_a_valid_result_not_an_exception():
    class AllFail:
        def generate(self, system, user, max_output_tokens):
            raise RuntimeError("nothing is up")

    result = run(provider=AllFail())
    assert isinstance(result, ResearchResult)
    assert result.workers_answered == 0
    assert result.degraded is True
    assert result.answer  # an outcome the caller can render, not a 500


def test_one_slow_worker_does_not_hold_up_the_other():
    """A hung worker must be dropped, not waited for.

    Without a per-worker deadline this passes anyway when nothing hangs, so the
    test hangs something.
    """

    class OneHangs:
        def generate(self, system, user, max_output_tokens):
            if system.startswith("ANGLE: counterpoint"):
                time.sleep(5)
            return Completion(text="fast finding", output_tokens=3)

    async def timed():
        started = time.monotonic()
        result = await research(TOPIC, OneHangs(), Budget(wall_clock_s=0.4, synthesis_wall_clock_s=0.15))
        return result, time.monotonic() - started

    result, elapsed = asyncio.run(timed())

    assert result.workers_answered == 1
    assert result.degraded is True
    # Timing the coroutine, not asyncio.run: the hung worker's thread cannot be
    # killed and asyncio.run waits for it at shutdown. What is being asserted is
    # that the *answer* is not held up -- which is exactly what the deadline
    # promises and all it promises. See cell.py on the request timeout.
    assert elapsed < 3, f"took {elapsed:.1f}s — the deadline did not stop the waiting"


def test_the_two_workers_actually_run_concurrently():
    """Otherwise the fan-out is decorative.

    Each worker sleeps; if they ran in sequence the run would take twice as long
    as the slower one.
    """

    class Slow:
        def generate(self, system, user, max_output_tokens):
            time.sleep(0.30)
            return Completion(text="finding", output_tokens=2)

    started = time.monotonic()
    run(provider=Slow(), budget=Budget(wall_clock_s=5, synthesis_wall_clock_s=1.5))
    elapsed = time.monotonic() - started
    # Two workers plus synthesis = 3 calls. Sequential would be ~0.9s;
    # concurrent workers make it ~0.6s.
    assert elapsed < 0.85, f"took {elapsed:.2f}s — the workers ran in sequence"


# -------------------------------------------------------------------- budget


def test_the_token_cap_travels_with_the_request():
    """The difference between a bound and a wish.

    A budget checked after the fact reports overspend; this asserts the cap is
    handed to the provider, which is the only place it can actually bind.
    """
    seen = []

    class Recording:
        def generate(self, system, user, max_output_tokens):
            seen.append(max_output_tokens)
            return Completion(text="x", output_tokens=1)

    budget = Budget(total_output_tokens=6_000, synthesis_output_tokens=1_200)
    run(provider=Recording(), budget=budget)

    assert len(seen) == 3  # two workers, one synthesis
    assert seen[:2] == [budget.worker_output_tokens] * 2
    assert seen[2] == budget.synthesis_output_tokens
    # Every cap in the run, summed, cannot exceed the budget.
    assert sum(seen) <= budget.total_output_tokens


def test_a_run_that_would_overspend_is_refused_not_trimmed():
    ledger = Ledger(budget=Budget(total_output_tokens=6_000, synthesis_output_tokens=1_200))
    ledger.record("worker", 5_900)
    with pytest.raises(BudgetExceeded):
        ledger.authorise("synthesis", 1_200)


def test_the_synthesis_reserve_survives_greedy_workers():
    """Workers spending their whole cap must still leave synthesis payable."""
    budget = Budget()
    ledger = Ledger(budget=budget)
    for angle in ANGLES:
        ledger.record(angle, budget.worker_output_tokens)
    # Does not raise: the reserve was never available to the workers.
    assert ledger.authorise("synthesis", budget.synthesis_output_tokens) > 0


def test_a_hung_worker_does_not_starve_synthesis():
    """The reserve exists because losing a worker must not lose the answer.

    Before this, one stalled worker consumed the whole deadline and the run
    returned "could not turn findings into an answer" -- throwing away a good
    finding it already had. Found by hanging a worker against a live service,
    not by any unit test that existed at the time.
    """

    class OneHangs:
        def generate(self, system, user, max_output_tokens):
            if system.startswith("ANGLE: counterpoint"):
                time.sleep(30)
            return Completion(text="a real finding", output_tokens=3)

    result = run(
        provider=OneHangs(),
        budget=Budget(wall_clock_s=1.2, synthesis_wall_clock_s=0.8),
    )
    assert result.workers_answered == 1
    assert result.degraded is True
    # The surviving finding was actually synthesised, not abandoned.
    assert any("Synthesised 1 finding" in line for line in result.trace), result.trace
    assert "could not turn them into an answer" not in result.answer


def test_spend_is_reported_so_a_run_can_be_audited():
    result = run()
    assert result.output_tokens > 0
    assert any("output tokens" in line for line in result.trace)


# ------------------------------------------------- the budget object itself


def test_a_budget_cannot_be_widened_after_construction():
    budget = Budget()
    with pytest.raises(Exception):
        budget.total_output_tokens = 10**9  # type: ignore[misc]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"rounds": 2},                                    # would make it unbounded
        {"wall_clock_s": 0},                              # no deadline at all
        {"workers": 0},                                   # no swarm
        {"wall_clock_s": 5, "synthesis_wall_clock_s": 5},  # no time for workers
        {"total_output_tokens": 100, "synthesis_output_tokens": 100},  # nothing left
    ],
)
def test_an_incoherent_budget_is_rejected_at_construction(kwargs):
    with pytest.raises(ValueError):
        Budget(**kwargs)
