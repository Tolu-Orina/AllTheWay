"""Hard caps on a research run.

The manifest's rule for the swarm is that it is *bounded*, and the plan says the
bounds are "enforced in code, not prompt". That distinction is the whole point
of this file, so it is worth being precise about what it means.

A prompt-level bound is a request. "Use at most two sources" is advice the model
may ignore, and nothing in the system notices when it does.

A code-level bound is a bound the model cannot exceed even if it tries:

    workers      there is no loop. Two angles are named as constants and the
                 fan-out is over exactly those. Nothing can widen it at runtime.
    rounds       there is no loop, so there is no second round to bound.
    wall clock   a deadline, enforced by abandoning the work. Split, so the
                 fan-out cannot spend the time synthesis needs.
    tokens       a per-worker output cap passed to the model API, so the cap is
                 applied by the provider, plus a refusal to start any call the
                 remaining budget cannot pay for.

The last one is the subtle one. Counting tokens after a response arrives tells
you that you overspent; it does not stop you overspending. The cap has to travel
with the request.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class BudgetExceeded(RuntimeError):
    """Raised when work is attempted that the remaining budget cannot pay for.

    Caught by the cell and turned into a degraded answer, never surfaced as a
    crash: running out of budget is a normal outcome, not a fault.
    """


@dataclass(frozen=True)
class Budget:
    """What a single research run is allowed to spend.

    Frozen because a budget that can be edited mid-run is not a budget. The cell
    receives one and cannot widen it.
    """

    #: Exactly two, per the architecture. Not a maximum to loop up to -- the
    #: fan-out is over two named angles, so this is an assertion about the code
    #: rather than a runtime limit.
    workers: int = 2

    #: One fan-out, one synthesis. There is no iterate-until-satisfied loop
    #: anywhere in this service, which is what makes an unbounded run
    #: impossible rather than merely unlikely.
    rounds: int = 1

    #: Whole-run deadline. A worker that has not answered by then is cancelled
    #: and the run degrades to whatever did answer.
    wall_clock_s: float = 20.0

    #: Reserved so synthesis can still run after a worker has hung.
    #:
    #: Without this, one stalled worker consumes the entire deadline and the run
    #: returns "could not turn findings into an answer" -- discarding a finding
    #: it actually had. The whole point of two workers is that losing one costs
    #: breadth, not the answer, and that only holds if there is time left to
    #: write the answer. Symmetric with the token reserve below.
    synthesis_wall_clock_s: float = 6.0

    #: Total output tokens across every call in the run, workers and synthesis.
    total_output_tokens: int = 6_000

    #: Reserved so synthesis can still run after the workers have spent theirs.
    #: Without this a greedy pair of workers would leave nothing to answer with.
    synthesis_output_tokens: int = 1_200

    def __post_init__(self) -> None:
        if self.workers < 1:
            raise ValueError("a research run needs at least one worker")
        if self.rounds != 1:
            raise ValueError("more than one round would make the run unbounded")
        if self.wall_clock_s <= 0:
            raise ValueError("wall clock must be positive")
        if self.synthesis_wall_clock_s >= self.wall_clock_s:
            raise ValueError("synthesis reserve must leave time for the workers")
        if self.synthesis_output_tokens >= self.total_output_tokens:
            raise ValueError("synthesis reserve must leave something for the workers")

    @property
    def worker_wall_clock_s(self) -> float:
        """How long the fan-out gets. The rest belongs to synthesis."""
        return self.wall_clock_s - self.synthesis_wall_clock_s

    @property
    def worker_output_tokens(self) -> int:
        """The per-worker output cap, sent with the request.

        The workers share what is left after the synthesis reserve, so the sum
        of every cap in the run cannot exceed the total even if every call
        returns the maximum it is allowed.
        """
        return (self.total_output_tokens - self.synthesis_output_tokens) // self.workers


@dataclass
class Ledger:
    """Tracks spend against a budget. One per run.

    Mutable, unlike the budget: this is the record of what happened, not the
    rule about what may happen.
    """

    budget: Budget
    spent_output_tokens: int = 0
    calls: list[str] = field(default_factory=list)

    @property
    def remaining_output_tokens(self) -> int:
        return max(0, self.budget.total_output_tokens - self.spent_output_tokens)

    def authorise(self, label: str, want_output_tokens: int) -> int:
        """Approve a call, returning the cap it must be made with.

        Refuses rather than trimming to zero: a call permitted a handful of
        tokens produces a truncated fragment that costs money and answers
        nothing, which is worse than not making it.
        """
        if want_output_tokens <= 0:
            raise ValueError("a call must be allowed some output")
        if self.remaining_output_tokens < want_output_tokens:
            raise BudgetExceeded(
                f"{label}: needs {want_output_tokens} output tokens, "
                f"{self.remaining_output_tokens} left of "
                f"{self.budget.total_output_tokens}"
            )
        return want_output_tokens

    def record(self, label: str, output_tokens: int) -> None:
        """Book actual spend. Never negative, and never silently forgotten."""
        self.spent_output_tokens += max(0, output_tokens)
        self.calls.append(label)
