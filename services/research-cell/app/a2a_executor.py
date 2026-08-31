"""Bridges the A2A protocol to the research cell.

    trace line   ->  TaskStatusUpdateEvent (WORKING)
    the answer   ->  exactly one TaskArtifactUpdateEvent, then COMPLETED

## Exactly one artifact

This is FR-10 enforced a second time, at the protocol boundary. `cell.research`
already cannot return worker text — but a future executor could, in principle,
add a second artifact carrying "the raw findings, for debugging". So the single
artifact is asserted by a test rather than left to intent.

Status updates carry trace lines, which describe *that* a swarm ran and how it
went. They never carry what a worker said.

## Degradation is not failure

A run that lost a worker still COMPLETEs, because it produced a usable answer.
TASK_STATE_FAILED is reserved for the cell being unable to answer at all — and
even then the cell returns a result rather than raising, so FAILED here means
something genuinely unexpected broke.
"""

from __future__ import annotations

import asyncio

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, Task, TaskState, TaskStatus
from google.protobuf import json_format, struct_pb2

from .budget import Budget
from .cell import research
from .providers import ResearchProvider

ANSWER_ARTIFACT_ID = "answer"


def _data_part(payload: dict) -> Part:
    """A structured part, matching the card's application/json output mode."""
    value = struct_pb2.Value()
    json_format.ParseDict(payload, value)
    return Part(data=value)


class ResearchExecutor(AgentExecutor):
    def __init__(self, provider: ResearchProvider, budget: Budget | None = None) -> None:
        self._provider = provider
        # Held on the executor, not read per request: a caller must not be able
        # to ask for a bigger budget than the deployment allows.
        self._budget = budget or Budget()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        # The Task itself must be on the queue before any status event, or the
        # framework rejects the response with INVALID_AGENT_RESPONSE.
        if context.current_task is None:
            await event_queue.enqueue_event(
                Task(
                    id=context.task_id,
                    context_id=context.context_id,
                    status=TaskStatus(state=TaskState.TASK_STATE_SUBMITTED),
                )
            )

        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.start_work()

        topic = (context.get_user_input() or "").strip()
        if not topic:
            await updater.failed(
                updater.new_agent_message([Part(text="No topic was given to research.")])
            )
            return

        await updater.update_status(
            TaskState.TASK_STATE_WORKING,
            message=updater.new_agent_message(
                [Part(text=f"Researching from {self._budget.workers} angles")]
            ),
            metadata={"kind": "trace"},
        )

        try:
            result = await research(topic, self._provider, self._budget)
        except Exception as exc:  # noqa: BLE001 — surfaced as a task state, not a 500
            # The cell degrades internally rather than raising, so reaching here
            # means something outside the modelled failures broke.
            await updater.failed(
                updater.new_agent_message([Part(text=f"The research cell failed: {exc}")])
            )
            return

        # Narrate after the fact rather than during: the fan-out is concurrent,
        # so there is no honest per-worker progress to report while it runs —
        # only which workers turned out to answer.
        for line in result.trace:
            await updater.update_status(
                TaskState.TASK_STATE_WORKING,
                message=updater.new_agent_message([Part(text=line)]),
                metadata={"kind": "trace"},
            )
            # Yield between updates so each reaches the wire as its own SSE
            # frame instead of being coalesced into one flush.
            await asyncio.sleep(0)

        await updater.add_artifact(
            [
                _data_part(
                    {
                        "answer": result.answer,
                        "trace": list(result.trace),
                        "degraded": result.degraded,
                        "workersStarted": result.workers_started,
                        "workersAnswered": result.workers_answered,
                        "outputTokens": result.output_tokens,
                        "sources": [
                            {"title": s["title"], "uri": s["uri"], "snippet": s.get("snippet", "")}
                            for s in result.sources
                        ],
                    }
                )
            ],
            artifact_id=ANSWER_ARTIFACT_ID,
            name="answer",
            append=False,
            last_chunk=True,
        )
        # Degraded is still complete: the caller got an answer it can use, and
        # `degraded` tells it how much to trust the breadth.
        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        # A run is bounded by its own wall clock and is over in seconds, so
        # there is no long-running work for a cancel to interrupt. Reporting
        # CANCELED would claim we stopped something that had already stopped.
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.reject(
            updater.new_agent_message(
                [Part(text="A research run is already bounded; there is nothing to cancel.")]
            )
        )
