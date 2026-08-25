"""Lets a blocking iterator stream without stalling the event loop.

The graph is a plain synchronous generator, and so is every model SDK call it
makes: `generate_content_stream` blocks the calling thread between chunks. Run
that directly inside an `async def` and the loop never gets control, so the
events pile up in the queue and the SSE writer only flushes once the turn is
already finished — streaming that streams nothing.

That failure is invisible to a type checker and to every unit test, because the
events are all correct and all present. It only shows up as timing, which is why
it was found by watching arrival times rather than by reading the code.

The graph stays synchronous on purpose. Making it `async` would mean an async
model provider, an async FakeProvider, and async tests, to solve a problem that
belongs at exactly one boundary: this one.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator, Callable, Iterator, TypeVar

T = TypeVar("T")

_DONE = object()


async def iter_in_thread(make_iterator: Callable[[], Iterator[T]]) -> AsyncIterator[T]:
    """Consume a blocking iterator on a worker thread, yielding as items land.

    Takes a factory rather than an iterator so the generator is *created* on the
    worker thread too — a generator built here would run its first block on the
    event loop before the thread ever took over.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def produce() -> None:
        try:
            for item in make_iterator():
                # Unbounded and non-blocking: the producer must never wait on the
                # loop, or a slow consumer would deadlock the thread it runs on.
                loop.call_soon_threadsafe(queue.put_nowait, (item, None))
        except BaseException as exc:  # noqa: BLE001 — re-raised on the loop below
            loop.call_soon_threadsafe(queue.put_nowait, (_DONE, exc))
            return
        loop.call_soon_threadsafe(queue.put_nowait, (_DONE, None))

    worker = asyncio.get_running_loop().run_in_executor(None, produce)

    try:
        while True:
            item, error = await queue.get()
            if error is not None:
                raise error
            if item is _DONE:
                return
            yield item
    finally:
        # If the consumer stopped early the thread is still draining; awaiting it
        # keeps a half-finished turn from outliving the request that asked for it.
        await worker
