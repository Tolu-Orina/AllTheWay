"""Turning a correction into a learned preference.

Deliberately deterministic. A correction already contains both halves of what
was learned — what the agent proposed and what the user changed it to — so
inventing a model call here would add nondeterminism to a step that has none.

The model earns its place later, generalising *across* many corrections
("you consistently shorten things") rather than restating one. That pass
is deterministic too: it writes a new `source: "synth"` row and never
overwrites a human one.

## Keys, not a pile

Two opposite facts both injected is worse than no memory (TEPA, Aug 2026).
A new correction under the same key stamps the previous active row rather than
sitting beside it. Independent facts in the same area keep distinct keys, so
"four nav items" does not overwrite "collapse the sidebar".
"""

from __future__ import annotations

import hashlib
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


@dataclass(frozen=True)
class Standing:
    """An already-stored preference, used only to key and to revoke."""

    id: str
    key: str
    area: str
    was: str
    now: str
    hat: str | None = None
    source: str = "session"


@dataclass(frozen=True)
class Planned:
    learned: Synthesised
    key: str
    revoke_ids: tuple[str, ...]


def classify(text: str) -> str:
    lowered = text.lower()
    for area, hints in AREA_HINTS:
        if any(h in lowered for h in hints):
            return area
    return "General"


def normalised(text: str) -> str:
    return " ".join(text.split()).casefold()


def key_stem(area: str, was: str, hat: str | None = None) -> str:
    digest = hashlib.sha256(normalised(was).encode("utf-8")).hexdigest()[:12]
    scope = (hat or "any").casefold()
    return f"area:{area.casefold()}:{scope}:{digest}"


def same_hat(row: Standing, hat: str | None) -> bool:
    return (row.hat or None) == (hat or None)


def key_for(*, area: str, was: str, standing: list[Standing], hat: str | None = None) -> str:
    """Reuse the key of a standing fact this correction continues or restates.

    Hat is part of the key. A home fact must not revoke a work fact that
    happens to use the same words.
    """

    was_n = normalised(was)
    for row in standing:
        if row.area and row.area != area:
            continue
        if not same_hat(row, hat):
            continue
        if normalised(row.now) == was_n or normalised(row.was) == was_n:
            return row.key or key_stem(area, row.was or was, hat)
    return key_stem(area, was, hat)


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


def plan_commit(
    *,
    was: str,
    now: str,
    standing: list[Standing],
    own_id: str,
    hat: str | None = None,
) -> Planned | None:
    """One write, and the ids it retires.

    `own_id` is excluded so an at-least-once redelivery of the same session
    does not revoke itself and then count itself as prior evidence.
    """

    was, now = was.strip(), now.strip()
    learned = synthesise(was=was, now=now, prior_corrections=0)
    if learned is None:
        return None

    key = key_for(area=learned.area, was=was, standing=standing, hat=hat)
    priors = [
        row
        for row in standing
        if row.id != own_id
        and same_hat(row, hat)
        and (
            (row.key and row.key == key)
            or (
                row.area == learned.area
                and (normalised(row.now) == normalised(was) or normalised(row.was) == normalised(was))
            )
        )
    ]
    learned = synthesise(was=was, now=now, prior_corrections=len(priors))
    assert learned is not None
    return Planned(
        learned=learned,
        key=key,
        revoke_ids=tuple(row.id for row in priors),
    )
