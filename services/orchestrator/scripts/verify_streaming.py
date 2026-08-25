"""Live check that streaming and non-streaming agree.

Unit tests fold artifact chunks the way a task store is *supposed* to. This
talks to a running orchestrator over real JSON-RPC and lets the SDK's actual
task store do the folding, which is the thing that would break in production.

    python scripts/verify_streaming.py [url]
"""

from __future__ import annotations

import asyncio
import sys
import time

import httpx
from a2a.client import ClientConfig, ClientFactory
from a2a.types import (
    GetTaskRequest,
    Message,
    Part,
    Role,
    SendMessageRequest,
    TaskState,
)
from google.protobuf import json_format

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
CLEAR = "Draft a nav wireframe for the desktop dashboard"
VAGUE = "do something"


def _message(text: str) -> Message:
    return Message(message_id=f"verify-{time.time_ns()}", role=Role.ROLE_USER,
                   parts=[Part(text=text)])


def _payloads(task) -> list[dict]:
    return [
        json_format.MessageToDict(p.data)
        for a in task.artifacts
        for p in a.parts
        if p.WhichOneof("content") == "data"
    ]


def _steps(task) -> list[str]:
    return [p["step"]["label"] for p in _payloads(task) if "step" in p]


async def _run(text: str, streaming: bool):
    async with httpx.AsyncClient(timeout=30.0) as http:
        factory = ClientFactory(ClientConfig(httpx_client=http, streaming=streaming))
        client = await factory.create_from_url(URL)

        task = None
        # In streaming mode the initial Task carries only SUBMITTED; the real
        # verdict arrives as status deltas. Reading task.status here would test
        # the wrong thing and pass for the wrong reason.
        state = None
        arrivals: list[tuple[float, str]] = []
        started = time.monotonic()

        async for response in client.send_message(SendMessageRequest(message=_message(text))):
            kind = response.WhichOneof("payload")
            if kind == "task":
                task = response.task
                state = task.status.state
            elif kind == "status_update":
                state = response.status_update.status.state
                arrivals.append((time.monotonic() - started, "status"))
            elif kind == "artifact_update":
                for part in response.artifact_update.artifact.parts:
                    if part.WhichOneof("content") == "data":
                        payload = json_format.MessageToDict(part.data)
                        if "step" in payload:
                            arrivals.append(
                                (time.monotonic() - started, payload["step"]["label"])
                            )
        return task, state, arrivals


async def _abandon(text: str):
    """Start a stream, walk away after the first step, return the task id."""
    async with httpx.AsyncClient(timeout=30.0) as http:
        factory = ClientFactory(ClientConfig(httpx_client=http, streaming=True))
        client = await factory.create_from_url(URL)

        task_id, seen = "", 0
        async for response in client.send_message(SendMessageRequest(message=_message(text))):
            kind = response.WhichOneof("payload")
            if kind == "task":
                task_id = response.task.id
            elif kind == "artifact_update":
                task_id = task_id or response.artifact_update.task_id
                for part in response.artifact_update.artifact.parts:
                    if part.WhichOneof("content") == "data":
                        if "step" in json_format.MessageToDict(part.data):
                            seen += 1
                if seen >= 1:
                    break  # the reader is gone from here on
        return task_id, seen


async def _get(task_id: str):
    """Fetch a task by id, the way a reconnecting client would."""
    await asyncio.sleep(1.5)  # let the abandoned turn finish on its own
    async with httpx.AsyncClient(timeout=30.0) as http:
        factory = ClientFactory(ClientConfig(httpx_client=http, streaming=False))
        client = await factory.create_from_url(URL)
        try:
            return await client.get_task(GetTaskRequest(id=task_id))
        except Exception as exc:  # noqa: BLE001 — reported as a failed check
            print(f"      get_task raised: {type(exc).__name__}: {exc}")
            return None


def main() -> int:
    failures: list[str] = []

    def check(ok: bool, label: str) -> None:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures.append(label)

    print(f"streaming, clear request -> {URL}")
    task, state, arrivals = asyncio.run(_run(CLEAR, streaming=True))
    steps = [a for a in arrivals if a[1] != "status"]
    for at, label in arrivals:
        print(f"      {at * 1000:7.1f}ms  {label}")
    check(len(steps) >= 2, "plan steps arrive as separate events")
    check(state == TaskState.TASK_STATE_COMPLETED, "the turn completes")
    check(any(a[1] == "status" for a in arrivals), "progress is narrated while working")
    check(
        len({label for _, label in steps}) == len(steps),
        "no step is ever emitted twice",
    )

    print("\nnon-streaming, same request")
    plain, plain_state, _ = asyncio.run(_run(CLEAR, streaming=False))
    check(plain_state == TaskState.TASK_STATE_COMPLETED, "task completes")
    # The real task store folded the appended chunks. This is the assertion the
    # unit test can only simulate.
    check(len(_steps(plain)) == len(steps),
          f"task store folded {len(steps)} chunks into one artifact")
    check(_steps(plain) == [label for _, label in steps],
          "streamed steps and stored steps are identical")
    check(any("trace" in p for p in _payloads(plain)), "trace survives folding")

    print("\nstreaming, ambiguous request")
    vague, vague_state, vague_arrivals = asyncio.run(_run(VAGUE, streaming=True))
    check(vague_state == TaskState.TASK_STATE_INPUT_REQUIRED,
          "the gate stops the turn at INPUT_REQUIRED")
    check([a for a in vague_arrivals if a[1] != "status"] == [],
          "not one plan step reaches the client")

    print()
    print("resumability after a mid-stream disconnect")
    task_id, seen = asyncio.run(_abandon(CLEAR))
    check(seen >= 1, f"the client saw {seen} step(s) before dropping")
    recovered = asyncio.run(_get(task_id))
    check(recovered is not None, "the abandoned task is still retrievable by id")
    if recovered is not None:
        check(
            recovered.status.state == TaskState.TASK_STATE_COMPLETED,
            "work continued to completion without the reader",
        )
        check(len(_steps(recovered)) == 4, f"all 4 steps survived ({len(_steps(recovered))})")

    print()
    if failures:
        print(f"{len(failures)} FAILED: " + "; ".join(failures))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
