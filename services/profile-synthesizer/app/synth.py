"""Turning a correction into a learned preference.

Deliberately deterministic. A correction already contains both halves of what
was learned — what the agent proposed and what the user changed it to — so
inventing a model call here would add nondeterminism to a step that has none.

The model earns its place later, generalising *across* many corrections
("you consistently shorten things") rather than restating one.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Which part of the product a correction is about. Matching is on the wording
#: the user actually changed, not on where in the UI it happened.
AREA_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("Navigation", ("nav", "navigation", "sidebar", "menu")),
    ("Writing", ("summary", "draft", "tone", "wording", "sentence")),
    ("Layout", ("grid", "layout", "column", "spacing")),
    ("Questions", ("ask", "clarify", "question")),
]


@dataclass(frozen=True)
class Synthesised:
    area: str
    was: str
    now: str
    evidence: str


def classify(text: str) -> str:
    lowered = text.lower()
    for area, hints in AREA_HINTS:
        if any(h in lowered for h in hints):
            return area
    return "General"


def synthesise(
    *,
    was: str,
    now: str,
    prior_corrections: int = 0,
) -> Synthesised | None:
    """Build a preference from one correction, or None if there is nothing to learn."""

    was, now = was.strip(), now.strip()

    # No change means nothing was learned. Recording it anyway would pad the
    # profile with entries the user never actually caused.
    if not was or not now or was == now:
        return None

    total = prior_corrections + 1
    evidence = (
        f"You changed this once"
        if total == 1
        else f"You have made this change {total} times"
    )

    return Synthesised(area=classify(f"{was} {now}"), was=was, now=now, evidence=evidence)
