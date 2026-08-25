"""The bounded swarm.

    topic ──┬── mainstream   ─┐
            └── counterpoint ─┴── synthesis ──> one answer

Two workers, one synthesis, no loop. The shape is the safety property, so it is
expressed as straight-line code rather than as configuration: there is nothing
here to set to three, and no iterate-until-satisfied construct to bound.

## Only the synthesis leaves

Manifest FR-10: a swarm never touches the user. That is enforced by the *type*
rather than by discipline -- `ResearchResult` has no field that can carry a
worker's text. Worker output exists only as a local, is consumed by synthesis,
and goes out of scope. There is no path by which a caller could render it, so
"we remembered not to return it" is not something anyone has to remember.

If synthesis cannot run, the answer says so. It never falls back to handing a
raw worker response to the caller, which would be exactly the leak FR-10
forbids, dressed up as a helpful degradation.

## Isolation

Each worker is a separate call with its own prompt string and no shared mutable
state, so there is no channel through which one could observe another. Isolation
here is structural, not a framework feature.

## Degradation

A worker that fails, hangs, or cannot be paid for is dropped and the run
continues with whoever answered. Losing one worker costs breadth, not the
answer -- which is the whole reason there are two.

## What the wall clock can and cannot do

The deadline reliably bounds *the caller*: a hung worker stops being waited on,
and the run returns. It does not kill the hung call, because Python cannot kill
a thread -- so that thread lives on until its own blocking call returns, holding
a slot in the pool.

The bound that stops the thread is therefore the provider's own request timeout,
not this deadline. Both exist on purpose: the deadline protects the answer, the
request timeout protects the process. Claiming the deadline does both would be
wrong, and would show up as thread-pool exhaustion under load rather than as a
failed test.
"""

from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .budget import Budget, BudgetExceeded, Ledger
from .providers import ResearchProvider

#: Exactly two, named. The fan-out is over this tuple, so widening the swarm
#: means editing code and passing review -- not setting a number at runtime.
ANGLES: tuple[str, ...] = ("mainstream", "counterpoint")

_WORKER_BRIEF = {
    "mainstream": (
        "Give the best-supported current understanding. State what is well "
        "established and how confident that is."
    ),
    "counterpoint": (
        "Give the strongest honest objection to the mainstream reading. Do not "
        "manufacture disagreement where there is none -- say so instead."
    ),
}

#: A dedicated pool, so a worker whose thread is orphaned by a timeout cannot
#: starve anything else in the process. Sized for several concurrent runs
#: because an orphan holds its slot until its own request timeout fires.
_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="research")

_SYNTHESIS_BRIEF = (
    "You are given independent findings on one topic. Produce a single short "
    "answer that a person can act on. Where the findings disagree, say so and "
    "say which is better supported. Never invent a source."
)


@dataclass(frozen=True)
class ResearchResult:
    """What leaves the cell.

    Deliberately has no field for worker output. See the module docstring: this
    is where FR-10 is enforced.
    """

    answer: str
    trace: list[str] = field(default_factory=list)
    workers_started: int = 0
    workers_answered: int = 0
    #: True when the answer rests on fewer findings than the run intended.
    degraded: bool = False
    output_tokens: int = 0


@dataclass
class _Finding:
    angle: str
    text: str


def _system_for(angle: str) -> str:
    # The angle name leads the prompt so the fake provider can tell workers
    # apart, and so a real trace of the call shows which branch produced what.
    return f"ANGLE: {angle}\n{_WORKER_BRIEF[angle]}"


async def _call(
    provider: ResearchProvider,
    label: str,
    system: str,
    user: str,
    cap: int,
    deadline: float,
) -> tuple[str, int]:
    """One model call, on a worker thread, under the run's deadline.

    `provider.generate` blocks, so calling it directly would hold the event loop
    and make the two workers sequential -- concurrency that exists only on
    paper. Running it in a pool is what makes the fan-out real.

    On timeout the await is abandoned but the thread is not: see the module
    docstring on what the wall clock can and cannot do.
    """
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError(f"{label}: no time left in the run")

    loop = asyncio.get_running_loop()
    completion = await asyncio.wait_for(
        loop.run_in_executor(_POOL, provider.generate, system, user, cap),
        timeout=remaining,
    )
    return completion.text, completion.output_tokens


async def _worker(
    provider: ResearchProvider,
    angle: str,
    topic: str,
    ledger: Ledger,
    deadline: float,
) -> _Finding:
    cap = ledger.authorise(angle, ledger.budget.worker_output_tokens)
    text, spent = await _call(provider, angle, _system_for(angle), topic, cap, deadline)
    ledger.record(angle, spent)
    return _Finding(angle=angle, text=text)


async def research(
    topic: str, provider: ResearchProvider, budget: Budget | None = None
) -> ResearchResult:
    budget = budget or Budget()
    ledger = Ledger(budget=budget)
    started = time.monotonic()
    run_deadline = started + budget.wall_clock_s
    # The workers get less than the run does, so a hung worker cannot spend the
    # time synthesis needs to write the answer the other worker made possible.
    worker_deadline = started + budget.worker_wall_clock_s
    trace = [f"Fanned out to {len(ANGLES)} workers: {', '.join(ANGLES)}"]

    # return_exceptions so one worker's failure cannot cancel the other. With
    # gather's default, a single raise takes the whole fan-out down and the
    # cell would degrade to nothing precisely when degrading gracefully matters.
    settled = await asyncio.gather(
        *(_worker(provider, angle, topic, ledger, worker_deadline) for angle in ANGLES),
        return_exceptions=True,
    )

    findings: list[_Finding] = []
    for angle, outcome in zip(ANGLES, settled):
        if isinstance(outcome, _Finding):
            findings.append(outcome)
        else:
            trace.append(f"{angle} did not answer ({_why(outcome)})")

    degraded = len(findings) < len(ANGLES)

    if not findings:
        # Valid, not an exception: "nobody answered" is an outcome the caller
        # must be able to show, and a 500 is not showable.
        trace.append("No worker answered; nothing to synthesise")
        return ResearchResult(
            answer="I could not research this right now — no source came back in time.",
            trace=trace,
            workers_started=len(ANGLES),
            workers_answered=0,
            degraded=True,
            output_tokens=ledger.spent_output_tokens,
        )

    if degraded:
        trace.append(f"Synthesising from {len(findings)} of {len(ANGLES)} findings")

    try:
        cap = ledger.authorise("synthesis", budget.synthesis_output_tokens)
        answer, spent = await _call(
            provider,
            "synthesis",
            f"ANGLE: synthesis\n{_SYNTHESIS_BRIEF}",
            _brief(topic, findings),
            cap,
            run_deadline,
        )
        ledger.record("synthesis", spent)
    except Exception as exc:  # noqa: BLE001 -- every failure degrades the same way
        # Falling back to a worker's raw text here would leak the swarm to the
        # user (FR-10). Saying what happened is the only honest degradation.
        trace.append(f"Synthesis did not complete ({_why(exc)})")
        return ResearchResult(
            answer="I gathered findings but could not turn them into an answer in time.",
            trace=trace,
            workers_started=len(ANGLES),
            workers_answered=len(findings),
            degraded=True,
            output_tokens=ledger.spent_output_tokens,
        )

    trace.append(f"Synthesised {len(findings)} finding(s) into one answer")
    trace.append(
        f"Spent {ledger.spent_output_tokens} of {budget.total_output_tokens} output tokens"
    )

    return ResearchResult(
        answer=answer,
        trace=trace,
        workers_started=len(ANGLES),
        workers_answered=len(findings),
        degraded=degraded,
        output_tokens=ledger.spent_output_tokens,
    )


def _brief(topic: str, findings: list[_Finding]) -> str:
    body = "\n\n".join(f"[{f.angle}]\n{f.text}" for f in findings)
    return f"Topic: {topic}\n\nFindings:\n{body}"


def _why(exc: BaseException) -> str:
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return "timed out"
    if isinstance(exc, BudgetExceeded):
        return "out of budget"
    return f"{type(exc).__name__}: {exc}"
