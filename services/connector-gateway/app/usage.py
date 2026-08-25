"""Counting connector calls, per user and per connector.

In memory, which is honest about what it is: a Cloud Run instance holds its own
counters, so with N instances the effective limit is N times the configured one.
That is a real weakness and it is written down rather than hidden — the fix is a
shared counter (Firestore or Redis), and the interface here is the seam for it.

It is still worth having. The limits exist to stop a runaway loop and a
misconfigured watcher, and a per-instance counter stops both. What it does not
stop is a determined caller spreading load across instances, which is a
different threat with a different answer.
"""

from __future__ import annotations

import time
from collections import deque

from .enforcement import Usage

MINUTE = 60.0
DAY = 86_400.0


class UsageStore:
    def __init__(self, now=time.monotonic) -> None:
        self._now = now
        self._calls: dict[tuple[str, str], deque[float]] = {}

    def usage(self, key: tuple[str, str]) -> Usage:
        now = self._now()
        calls = self._calls.get(key)
        if calls is None:
            return Usage()

        # Trim on read: a key nobody touches costs nothing, and a key in use is
        # trimmed exactly when its counts are about to be read.
        while calls and now - calls[0] > DAY:
            calls.popleft()

        return Usage(
            last_minute=sum(1 for at in calls if now - at <= MINUTE),
            today=len(calls),
        )

    def record(self, key: tuple[str, str]) -> None:
        self._calls.setdefault(key, deque()).append(self._now())
