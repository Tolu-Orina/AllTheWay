"""Screening untrusted content, before a model reads it.

A watcher reads things strangers wrote. That content ends up in the same prompt
as the user's own instructions, and a model cannot reliably tell the two apart —
which is the whole mechanism of prompt injection. So the defence cannot be "the
model will notice". It has to be that content is screened *before a model sees
it*, and that a bad verdict stops the run rather than colouring it.

Manifest risk table: "Model Armor-equivalent guardrail screening is mandatory on
all Watcher-ingested external content, not optional per-connector."

## Fail closed

`screen()` returns **blocked** when the screener errors, times out, or is not
configured. This is the opposite of how most middleware behaves, and it is
deliberate: a screening step that passes content through when it is broken
provides no security at all, because an attacker's first move is to break it.
The cost of failing closed is a watcher that stops running until screening is
healthy, which is the correct trade for content nobody vouched for.

## What the heuristic screener is, and is not

`HeuristicScreener` matches known injection phrasings. It is a real layer and it
catches the common attacks, but it is **pattern matching**: it will miss a
paraphrase, another language, or an encoding it has not seen. It exists so the
behaviour around screening — halting, tracing, failing closed — is exercised
with no cloud project, and as defence in depth underneath the real thing.

`ModelArmorScreener` is the production screener. Anything that claims otherwise
is claiming a regex is a security boundary.

## Never echo the payload

A finding names a category and the rule that fired. It never quotes the matched
text. Repeating an injection into a trace a user reads, or into anything a model
later summarises, hands the attack a second delivery route — the block becomes
the relay.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Literal, Protocol

Direction = Literal["inbound", "outbound"]

#: Screening runs on both directions. Inbound is content arriving from the
#: world; outbound is what the model produced from it, which can carry an
#: injection's payload back out (an exfiltration URL, a leaked instruction).
DIRECTIONS: tuple[Direction, ...] = ("inbound", "outbound")


@dataclass(frozen=True)
class Finding:
    """Why the screener objected. Deliberately carries no payload text."""

    category: str
    #: Names the rule, not the match. "instruction override" — never the
    #: sentence that overrode.
    rule: str
    confidence: float = 1.0


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    screener: str
    direction: Direction = "inbound"
    findings: list[Finding] = field(default_factory=list)
    #: Set when the verdict is a fail-closed default rather than a real result.
    degraded: bool = False

    def summary(self) -> str:
        """One line, safe to show a user and to store."""
        if self.allowed:
            return f"Screened {self.direction} content: nothing flagged ({self.screener})."
        if self.degraded:
            return (
                f"Screening was unavailable, so this {self.direction} content was "
                f"not allowed through ({self.screener})."
            )
        rules = ", ".join(sorted({f.rule for f in self.findings})) or "unspecified"
        # Leads with the fact that screening acted, so a trace reads as a thing
        # the system did rather than a thing that merely happened.
        return (
            f"Screening blocked this {self.direction} content: "
            f"possible prompt injection ({rules})."
        )


class Screener(Protocol):
    name: str

    def screen(self, text: str, direction: Direction) -> Verdict: ...


# --------------------------------------------------------------------- heuristic

#: Ordered by how strongly each signals an attack rather than ordinary prose.
#: Each entry is (rule name, pattern). Patterns are deliberately narrow: a rule
#: that fires on normal email makes the product unusable, and a screen everyone
#: disables protects nobody.
_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = tuple(
    (category, rule, re.compile(pattern, re.IGNORECASE | re.DOTALL))
    for category, rule, pattern in (
        (
            "prompt_injection",
            "instruction override",
            r"\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(of\s+)?(the\s+)?"
            r"(previous|prior|earlier|above)\s+(instructions?|prompts?|rules?|context)",
        ),
        (
            "prompt_injection",
            "role reassignment",
            r"\byou\s+are\s+now\s+(in\s+)?(a\s+|an\s+|the\s+)?"
            r"(maintenance|developer|debug|admin|god|dan)\b",
        ),
        (
            "prompt_injection",
            "system prompt probe",
            r"\b(reveal|print|repeat|show|output)\s+(me\s+)?(your|the)\s+"
            r"(system\s+prompt|initial\s+instructions|hidden\s+instructions)",
        ),
        (
            "prompt_injection",
            "concealment",
            r"\b(do\s+not|don't|never)\s+(tell|mention|inform|reveal\s+this\s+to)\s+"
            r"(the\s+)?(user|human|owner|them)\b",
        ),
        (
            "prompt_injection",
            "exfiltration",
            r"\b(forward|send|email|upload|post)\b[^.\n]{0,60}\b"
            r"(contents?|mailbox|inbox|messages?|credentials?|password|api\s*key)\b",
        ),
        (
            "jailbreak",
            "guardrail bypass",
            r"\b(bypass|override|disable|turn\s+off)\s+"
            r"(your\s+|the\s+|all\s+)?(safety|guardrails?|filters?|restrictions?)",
        ),
    )
)


class HeuristicScreener:
    """Local pattern matching. A floor, not a ceiling — see the module docstring."""

    name = "heuristic"

    def screen(self, text: str, direction: Direction) -> Verdict:
        findings = [
            Finding(category=category, rule=rule, confidence=0.8)
            for category, rule, pattern in _PATTERNS
            if pattern.search(text)
        ]
        return Verdict(
            allowed=not findings,
            screener=self.name,
            direction=direction,
            findings=findings,
        )


# ------------------------------------------------------------------ model armor


class ModelArmorScreener:
    """Google Cloud Model Armor. The production screener.

    Deliberately unimplemented rather than approximated. Model Armor is a REST
    service that screens prompts and responses for injection, jailbreak, PII and
    malicious URLs against a configured template. Writing that call against no
    project would produce code that compiles, has never run, and would be
    trusted precisely because it looks finished — while being the one component
    whose failure is silent.

    It lands with Phase 0, alongside the project. Until then `create_screener`
    does not return it outside production, and in production it fails closed.
    """

    name = "model-armor"

    def __init__(self, template: str) -> None:
        self.template = template

    def screen(self, text: str, direction: Direction) -> Verdict:
        raise NotImplementedError(
            "Model Armor screening is not configured. Set MODEL_ARMOR_TEMPLATE "
            "and deploy with a project that has the API enabled."
        )


def create_screener() -> Screener:
    """The real screener where configured, the local one otherwise."""
    template = os.environ.get("MODEL_ARMOR_TEMPLATE", "").strip()
    if template:
        return ModelArmorScreener(template)
    return HeuristicScreener()


# ------------------------------------------------------------------------ screen


def screen(
    text: str,
    direction: Direction = "inbound",
    screener: Screener | None = None,
) -> Verdict:
    """Screen `text`, failing closed.

    Any failure of the screener itself — unconfigured, unreachable, raising —
    produces a *blocked* verdict marked `degraded`. A screening step that lets
    content through when it is broken is not a control; it is a formality that
    an attacker removes by breaking it.
    """
    chosen = screener or create_screener()

    if not text or not text.strip():
        # Nothing to screen. Not a degraded verdict: empty content carries no
        # instructions, and blocking it would stop watchers that legitimately
        # fire on an empty body.
        return Verdict(allowed=True, screener=chosen.name, direction=direction)

    try:
        return chosen.screen(text, direction)
    except Exception:  # noqa: BLE001 — every failure means the same thing here
        return Verdict(
            allowed=False,
            screener=chosen.name,
            direction=direction,
            findings=[Finding(category="screening_unavailable", rule="fail closed")],
            degraded=True,
        )
