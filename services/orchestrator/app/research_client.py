"""Calls the research cell over A2A.

The cell is reached the same way every other agent in this system is reached: by
resolving its published card and speaking the protocol. The orchestrator does
not know the cell's URL shape, its method names, or that it runs a swarm at all
— it knows a card that advertises one skill returning one answer.

That ignorance is the point. The cell can change how it researches without the
orchestrator changing at all, and the orchestrator has no way to reach past the
card and address a worker.

## Failure is not fatal here

A turn that cannot research must still produce a plan. Every failure path in
this module returns `None`, and the graph carries on planning without the
finding, saying so in the trace. Research makes a plan better; it is not a
precondition for having one.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field

import httpx
from alltheway_agentauth import auth_headers
from a2a.client import ClientConfig, ClientFactory
from a2a.types import Message, Part, Role, SendMessageRequest, TaskState
from google.protobuf import json_format

RESEARCH_CELL_URL = os.environ.get("RESEARCH_CELL_URL", "http://localhost:8093")

#: Bounds the orchestrator's own patience. The cell has its own wall clock; this
#: is the caller's, and it is deliberately a little longer so a cell that is
#: about to give up cleanly gets the chance to, and we see its trace.
TIMEOUT_S = float(os.environ.get("RESEARCH_TIMEOUT_S", "30"))


@dataclass(frozen=True)
class Finding:
    """What the cell returned. Mirrors its artifact, nothing more."""

    answer: str
    trace: list[str] = field(default_factory=list)
    degraded: bool = False
    workers_answered: int = 0


def _message(topic: str) -> Message:
    return Message(
        message_id=f"research-{os.urandom(6).hex()}",
        role=Role.ROLE_USER,
        parts=[Part(text=topic)],
    )


async def _send(topic: str) -> Finding | None:
    async with httpx.AsyncClient(timeout=TIMEOUT_S, headers=auth_headers(RESEARCH_CELL_URL)) as http:
        factory = ClientFactory(
            # Non-streaming: the orchestrator wants the finished answer. The
            # cell's progress narration is relayed from the artifact's trace
            # afterwards, which arrives complete rather than in pieces.
            ClientConfig(httpx_client=http, streaming=False)
        )
        client = await factory.create_from_url(RESEARCH_CELL_URL)

        task = None
        async for response in client.send_message(SendMessageRequest(message=_message(topic))):
            if response.WhichOneof("payload") == "task":
                task = response.task

        if task is None or task.status.state != TaskState.TASK_STATE_COMPLETED:
            return None

        for artifact in task.artifacts:
            for part in artifact.parts:
                if part.WhichOneof("content") != "data":
                    continue
                payload = json_format.MessageToDict(part.data)
                if "answer" not in payload:
                    continue
                return Finding(
                    answer=payload.get("answer", ""),
                    trace=list(payload.get("trace", [])),
                    degraded=bool(payload.get("degraded", False)),
                    workers_answered=int(payload.get("workersAnswered", 0)),
                )
        return None


def research(topic: str) -> Finding | None:
    """Synchronous wrapper. `None` means "plan without it", never an exception.

    The graph is a synchronous generator consumed on a worker thread (see
    `aio.py`), so there is no running loop here to clash with.
    """
    try:
        return asyncio.run(_send(topic))
    except Exception:  # noqa: BLE001 — an unreachable cell must not fail the turn
        return None
