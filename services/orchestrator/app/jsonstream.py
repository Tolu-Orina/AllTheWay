"""Reads a JSON object while it is still arriving.

A model streams its answer as text, so at any moment we hold a prefix of a JSON
document. This turns that prefix into the largest *valid* document it contains,
by truncating to the last complete value and closing whatever is still open:

    {"decision":"plan","steps":["Scope the wo    ->  {"decision":"plan","steps":[]}
    {"decision":"plan","steps":["Scope","Draft"  ->  {"decision":"plan","steps":["Scope","Draft"]}

The truncation rule is the important one. A half-arrived string is *dropped*
rather than surfaced, so a caller never sees "Draft the fir" become "Draft the
first pass" a moment later. Every value this yields is final, which is what lets
the UI append a plan step and never take it back.
"""

from __future__ import annotations

import json
from typing import Any, Literal

_Frame = Literal["obj", "arr"]

# What the scanner expects next inside the innermost container.
_KEY, _COLON, _VALUE, _COMMA = "key", "colon", "value", "comma"

_WS = " \t\r\n"
_OPEN = {"{": "obj", "[": "arr"}
_CLOSE = {"}": "obj", "]": "arr"}


def _strip_fence(text: str) -> str:
    """Tolerate ```json fences. Vertex should not emit them; other models do."""
    stripped = text.lstrip()
    if not stripped.startswith("```"):
        return text
    body = stripped.split("\n", 1)[1] if "\n" in stripped else ""
    return body.split("```", 1)[0]


def repair(text: str) -> str:
    """The longest valid JSON document contained in `text`, or `{}`."""
    text = _strip_fence(text)

    frames: list[_Frame] = []
    states: list[str] = []
    in_string = False
    escaped = False
    in_atom = False  # a bare number/true/false/null still being read

    # The safe cut: a prefix length, plus the containers open at that point.
    safe = 0
    safe_frames: list[_Frame] = []

    def mark(end: int) -> None:
        nonlocal safe, safe_frames
        safe, safe_frames = end, list(frames)

    def value_done(end: int) -> None:
        """A complete value just landed; the enclosing container can be closed."""
        if states:
            states[-1] = _COMMA
        mark(end)

    for i, c in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_string = False
                # A key is not a value: `{"a"` cannot be closed to `{"a"}`.
                if states and states[-1] == _KEY:
                    states[-1] = _COLON
                else:
                    value_done(i + 1)
            continue

        if in_atom:
            if c in _WS or c in ",}]":
                in_atom = False
                value_done(i)
            else:
                continue  # fall through only once the atom has ended

        if c in _WS:
            continue

        if c == '"':
            in_string = True
            continue

        if c in _OPEN:
            frames.append(_OPEN[c])  # type: ignore[arg-type]
            states.append(_KEY if c == "{" else _VALUE)
            mark(i + 1)  # an empty container is itself valid
            continue

        if c in _CLOSE:
            if not frames or frames[-1] != _CLOSE[c]:
                break  # malformed; keep the last good cut
            frames.pop()
            states.pop()
            value_done(i + 1)
            continue

        if c == ":":
            if states:
                states[-1] = _VALUE
            continue

        if c == ",":
            if states:
                states[-1] = _KEY if frames and frames[-1] == "obj" else _VALUE
            continue

        # Anything else starts a bare atom: 1, -2.5, true, null.
        in_atom = True

    if in_atom:
        # The buffer ended mid-atom, so the atom is not known to be complete.
        pass

    if safe == 0:
        return "{}"

    closers = "".join("}" if f == "obj" else "]" for f in reversed(safe_frames))
    return text[:safe] + closers


def parse_partial(text: str) -> dict[str, Any]:
    """Best-effort object from a prefix. Never raises; `{}` when nothing is usable."""
    try:
        value = json.loads(repair(text))
    except (ValueError, RecursionError):
        return {}
    return value if isinstance(value, dict) else {}
