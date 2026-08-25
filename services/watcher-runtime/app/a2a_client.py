"""Calls the orchestrator over A2A.

A watcher run and a live session must traverse identical machinery — that is
the architecture's claim (§6) and the reason a watcher's output is trustworthy.
Before this, the watcher used a bespoke `POST /turn` while the gateway used
A2A, so the claim was only approximately true. Now both speak the protocol.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx
from alltheway_agentauth import auth_headers
from a2a.client import ClientConfig, ClientFactory
from a2a.types import Message, Part, Role, SendMessageRequest, Task, TaskState
from google.protobuf import json_format, struct_pb2

ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://localhost:8090")

#: Mirrors the orchestrator's PREFERENCES_KEY. Metadata, never message text.
PREFERENCES_KEY = "knownPreferences"


class OrchestratorUnavailable(RuntimeError):
    """The orchestrator could not be reached or refused the task."""


def _build_message(text: str, preferences: list[str]) -> Message:
    message = Message(
        message_id=f"watcher-{os.urandom(6).hex()}",
        role=Role.ROLE_USER,
        parts=[Part(text=text)],
    )
    if preferences:
        metadata = struct_pb2.Struct()
        json_format.ParseDict({PREFERENCES_KEY: preferences}, metadata)
        message.metadata.CopyFrom(metadata)
    return message


async def _send(text: str, preferences: list[str]) -> Task:
    async with httpx.AsyncClient(timeout=30.0, headers=auth_headers(ORCHESTRATOR_URL)) as http:
        factory = ClientFactory(
            ClientConfig(
                httpx_client=http,
                # Match the orchestrator's card, which declares streaming=false
                # until Phase 2. Asking for streaming it does not advertise
                # would rely on a fallback rather than on the contract.
                streaming=False,
            )
        )
        # Discovery, not configuration: the URL locates the card, and the card
        # decides the transport and protocol version.
        client = await factory.create_from_url(ORCHESTRATOR_URL)

        task: Task | None = None
        async for response in client.send_message(
            SendMessageRequest(message=_build_message(text, preferences))
        ):
            if response.WhichOneof("payload") == "task":
                task = response.task

        if task is None:
            raise OrchestratorUnavailable("orchestrator returned no task")
        return task


def _data_payloads(task: Task) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for artifact in task.artifacts:
        for part in artifact.parts:
            if part.WhichOneof("content") == "data":
                payloads.append(json_format.MessageToDict(part.data))
    return payloads


def run_turn(text: str, preferences: list[str]) -> dict[str, Any]:
    """Synchronous wrapper returning the shape the runtime already expects.

    FastAPI runs sync endpoints in a worker thread, so there is no running loop
    to clash with, and Firestore's blocking client keeps working as-is. Making
    the whole path async would put blocking database calls on the event loop —
    a worse trade than one `asyncio.run` at the boundary.
    """
    task = asyncio.run(_send(text, preferences))
    payloads = _data_payloads(task)

    if task.status.state == TaskState.TASK_STATE_INPUT_REQUIRED:
        clarification = next((p for p in payloads if "question" in p), {})
        spoken = next(
            (p.text for p in task.status.message.parts if p.WhichOneof("content") == "text"),
            None,
        ) if task.status.HasField("message") else None
        return {
            "decision": "clarify",
            "clarify": {
                "question": clarification.get("question") or spoken or "This needs your input.",
            },
        }

    if task.status.state == TaskState.TASK_STATE_COMPLETED:
        # One `{step}` part per step, in order, plus a closing part carrying the
        # note and trace. Same representation whether the orchestrator streamed
        # it or the task store folded it, so this client need not care which.
        steps = [p["step"] for p in payloads if "step" in p]
        return {"decision": "plan", "plan": steps}

    raise OrchestratorUnavailable(
        f"orchestrator task ended in state {TaskState.Name(task.status.state)}"
    )
