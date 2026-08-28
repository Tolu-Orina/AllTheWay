"""Sleep-time synthesis: generalise *across* keyed human rows.

A Generator/Critic that restates one was/now is theatre. This earns its
place only when several independent keys in the same area point the same
way. The write is a *new* row with source synth. A human row is never
overwritten. Low confidence stays proposed and is not injected.
"""

from __future__ import annotations

from dataclasses import dataclass

from .synth import Standing, normalised

#: Below this, the row is visible on You and not injected until accepted.
ACTIVATION = 0.6

#: Two independent keys is a pattern. One is a single correction.
MIN_KEYS = 2


@dataclass(frozen=True)
class Proposal:
    area: str
    was: str
    now: str
    evidence: str
    confidence: float
    proposed: bool
    key: str
    hat: str | None


def _words(text: str) -> int:
    return len(normalised(text).split())


def generalise(*, standing: list[Standing]) -> list[Proposal]:
    """Propose at most one generalisation per area and hat.

    Work and home of the same words are different groups. A home
    pattern must not be proposed from work rows, and the other way round.
    """

    by_group: dict[tuple[str, str | None], list[Standing]] = {}
    for row in standing:
        by_group.setdefault((row.area or "General", row.hat or None), []).append(row)

    out: list[Proposal] = []
    for (area, hat), rows in by_group.items():
        humans = [row for row in rows if row.source != "synth"]
        keys = {row.key for row in humans if row.key}
        if len(keys) < MIN_KEYS:
            continue
        shortened = [row for row in humans if _words(row.now) < _words(row.was)]
        if len({row.key for row in shortened}) < MIN_KEYS:
            continue
        if any(row.source == "synth" for row in rows):
            continue
        n = len({row.key for row in shortened})
        confidence = min(0.9, 0.35 + 0.1 * n)
        out.append(
            Proposal(
                area=area,
                was="the length of writing you were shown",
                now="you consistently shorten writing",
                evidence=f"You shortened writing across {n} separate corrections",
                confidence=confidence,
                proposed=confidence < ACTIVATION,
                key=f"synth:{area.casefold()}:{(hat or 'any')}:shorten",
                hat=hat,
            )
        )
    return out
