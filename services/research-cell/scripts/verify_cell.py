"""Live checks against a running research cell.

Unit tests assert the bounds with stubs. This talks to the real service over
JSON-RPC, because the claims that matter here are about a process under
pressure: a worker that dies, a worker that hangs, a budget that runs out.

The failure cases need the service restarted with fault injection, so this takes
a mode argument rather than doing everything in one pass:

    python scripts/verify_cell.py healthy      # nothing injected
    python scripts/verify_cell.py degraded     # FAKE_RESEARCH_FAIL=counterpoint
    python scripts/verify_cell.py hung         # FAKE_RESEARCH_HANG_S_COUNTERPOINT=30
"""

from __future__ import annotations

import asyncio
import sys
import time

import httpx
from a2a.client import ClientConfig, ClientFactory
from a2a.types import Message, Part, Role, SendMessageRequest, TaskState
from google.protobuf import json_format

URL = "http://127.0.0.1:8093"
TOPIC = "whether four-day weeks reduce burnout"

#: Distinctive phrases only a worker produces. If one of these reaches the
#: answer, the swarm has leaked past its synthesis (FR-10).
WORKER_PHRASES = ("strongest objection", "reproduced across", "[mainstream]", "[counterpoint]")

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail else ''}")
    if not ok:
        failures.append(label)


async def run() -> tuple[object, list[str], list[str], float]:
    """Returns (task, artifact payloads, narrated lines, elapsed seconds)."""
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=60.0) as http:
        factory = ClientFactory(ClientConfig(httpx_client=http, streaming=True))
        client = await factory.create_from_url(URL)

        state, payloads, narration = None, [], []
        async for response in client.send_message(
            SendMessageRequest(
                message=Message(
                    message_id=f"verify-{time.time_ns()}",
                    role=Role.ROLE_USER,
                    parts=[Part(text=TOPIC)],
                )
            )
        ):
            kind = response.WhichOneof("payload")
            if kind == "task":
                state = response.task.status.state
            elif kind == "status_update":
                state = response.status_update.status.state
                status = response.status_update.status
                if status.HasField("message"):
                    narration.extend(
                        p.text for p in status.message.parts if p.WhichOneof("content") == "text"
                    )
            elif kind == "artifact_update":
                for part in response.artifact_update.artifact.parts:
                    if part.WhichOneof("content") == "data":
                        payloads.append(json_format.MessageToDict(part.data))
        return state, payloads, narration, time.monotonic() - started


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "healthy"
    state, payloads, narration, elapsed = asyncio.run(run())
    print(f"mode: {mode}   elapsed: {elapsed:.2f}s")

    check(state == TaskState.TASK_STATE_COMPLETED, "the run completes", str(state))
    check(len(payloads) == 1, "exactly one artifact leaves the cell", f"{len(payloads)}")
    if not payloads:
        return 1

    answer = payloads[0]
    print(f"      answer: {answer['answer'][:100]}")
    for line in narration:
        print(f"      narrated: {line}")

    check(bool(answer.get("answer")), "there is an answer")
    check(
        any("Fanned out to 2 workers" in line for line in narration),
        "the fan-out is narrated while working",
    )

    leaked = [p for p in WORKER_PHRASES if p in str(answer)]
    check(not leaked, "no worker text leaves the cell", ", ".join(leaked))

    if mode == "healthy":
        check(answer.get("workersAnswered") == 2, "both workers answered")
        check(answer.get("degraded") is False, "the run is not degraded")
    else:
        # The exit criterion: killing a worker mid-run still returns a
        # degraded-but-valid answer.
        check(answer.get("workersAnswered") == 1, "one worker was lost",
              f"answered={answer.get('workersAnswered')}")
        check(answer.get("degraded") is True, "the result says it is degraded")
        check(bool(answer.get("answer")), "an answer is still returned")
        check(
            any("did not answer" in line for line in answer.get("trace", [])),
            "the trace says which worker was lost",
        )

    if mode == "hung":
        # The wall clock must bound the run, not the hung worker's 30s sleep.
        check(elapsed < 25, "the wall clock bounded the run", f"{elapsed:.1f}s")

    print()
    if failures:
        print(f"{len(failures)} FAILED: " + "; ".join(failures))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
