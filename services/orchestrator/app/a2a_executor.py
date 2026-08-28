"""Bridges the A2A protocol to the orchestrator graph.

The mapping is the interesting part, and it is not incidental:

    graph trace line          ->  TaskStatusUpdateEvent (WORKING)
    graph plan step           ->  TaskArtifactUpdateEvent, appended
    graph decision "clarify"  ->  TASK_STATE_INPUT_REQUIRED
    graph decision "plan"     ->  TASK_STATE_COMPLETED
    provider/transport error  ->  TASK_STATE_FAILED

The Clarify Gate is not something we bolted onto A2A — INPUT_REQUIRED is a
first-class state in the protocol's task lifecycle, and it means exactly what
the gate means: the agent stopped and needs something from you before it can
continue. Callers therefore get the gate for free from any conformant A2A
client, without knowing anything about AllTheWay.

Streaming is not a second code path. The executor consumes `run_turn_stream`
and emits as it goes; a non-streaming `message/send` gets the identical events,
which the task store folds into one finished task before returning it. So a
caller that cannot stream sees exactly what a caller that can would have seen
at the end — the only difference is when.
"""

from __future__ import annotations

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, Task, TaskState, TaskStatus
from google.protobuf import json_format, struct_pb2

from .aio import iter_in_thread
from .graph import run_turn_stream
from .models import Citation, Passage, TurnRequest
from .providers import ModelProvider

#: Key under which the caller passes what the profile already knows.
PREFERENCES_KEY = "knownPreferences"
#: Retrieved passages, same channel as preferences, same reason: they are
#: context, not something the user said, and must not be concatenated into
#: the message text.
PASSAGES_KEY = "passages"
LOOKUPS_KEY = "lookups"

#: Stable ids, so appended chunks land on one artifact rather than becoming
#: N single-part artifacts. TaskUpdater mints a fresh uuid when not told one.
PLAN_ARTIFACT_ID = "plan"
CLARIFICATION_ARTIFACT_ID = "clarification"
#: Distinct from the clarification artifact even though both end in
#: INPUT_REQUIRED. A caller must be able to tell "I do not understand you" from
#: "I understand you, and I am not doing that without a yes".
CONFIRMATION_ARTIFACT_ID = "confirmation"


def _data_part(payload: dict) -> Part:
    """A structured part, matching the card's application/json output mode."""
    value = struct_pb2.Value()
    json_format.ParseDict(payload, value)
    return Part(data=value)


def _preferences_from(context: RequestContext) -> list[str]:
    """Read learned preferences from message metadata, never from the text.

    Deliberate: appending them to the user's message makes them
    indistinguishable from something the user said, which corrupts any echo of
    the request and is the exact shape prompt injection takes once untrusted
    content is in play. The protocol gives us a separate channel; use it.
    """
    message = getattr(context, "message", None)
    metadata = getattr(message, "metadata", None)
    if metadata is None:
        return []
    try:
        raw = json_format.MessageToDict(metadata).get(PREFERENCES_KEY, [])
    except Exception:
        return []
    return [str(item) for item in raw if str(item).strip()]


def _passages_from(context: RequestContext) -> list[Passage]:
    """Read retrieved passages from message metadata, never from the text.

    The gateway retrieved them under the caller's identity. This service is
    stateless and does not re-query — so the passage text that lands here is
    the passage text that was in the prompt (FR-D2). No uid is accepted from
    the payload; path-scoping already happened upstream.
    """
    message = getattr(context, "message", None)
    metadata = getattr(message, "metadata", None)
    if metadata is None:
        return []
    try:
        raw = json_format.MessageToDict(metadata).get(PASSAGES_KEY, [])
    except Exception:
        return []
    if not isinstance(raw, list):
        return []

    passages: list[Passage] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str):
            continue
        chunk = item.get("chunkId", item.get("chunk_id", ""))
        document = item.get("documentId", item.get("document_id", ""))
        title = item.get("title") if isinstance(item.get("title"), str) else ""
        page = item.get("page")
        page_n = int(page) if isinstance(page, (int, float)) and not isinstance(page, bool) else 0
        passages.append(
            Passage(
                chunk_id=str(chunk) if chunk else "",
                document_id=str(document) if document else "",
                title=title,
                page=page_n,
                text=text,
            )
        )
    return passages


def _lookups_from(context: RequestContext) -> list[str]:
    """Connected-account reads from message metadata, never from the text."""
    message = getattr(context, "message", None)
    metadata = getattr(message, "metadata", None)
    if metadata is None:
        return []
    try:
        raw = json_format.MessageToDict(metadata).get(LOOKUPS_KEY, [])
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item).strip()]


def _citation_wire(citation: Citation) -> dict:
    """CamelCase payload the gateway maps to SSE. No uid."""
    return {
        "documentId": citation.document_id,
        "chunkId": citation.chunk_id,
        "page": citation.page,
        "title": citation.title,
        "text": citation.text,
    }


class OrchestratorExecutor(AgentExecutor):
    def __init__(self, provider: ModelProvider) -> None:
        self._provider = provider

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        # The Task itself must be on the queue before any status event, or the
        # framework rejects the response with INVALID_AGENT_RESPONSE. TaskUpdater
        # only emits updates; it never creates the task it updates.
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

        request = TurnRequest(
            session_id=context.context_id or "session",
            user_id=context.tenant or "user",
            message=context.get_user_input() or "",
            known_preferences=_preferences_from(context),
            passages=_passages_from(context),
            lookups=_lookups_from(context),
        )

        trace: list[str] = []
        steps = 0
        clarify = None
        confirm: dict | None = None
        note = ""
        citations: list[dict] = []

        try:
            # On a worker thread: the graph and the model SDK both block
            # between chunks, and blocking here would hold the event loop
            # so nothing reached the wire until the turn was already over.
            async for event in iter_in_thread(
                lambda: run_turn_stream(request, self._provider)
            ):
                if event.kind == "trace":
                    trace.append(event.text)
                    # Progress narration belongs in status, not in the artifact:
                    # it describes the work, it is not the work's product.
                    await updater.update_status(
                        TaskState.TASK_STATE_WORKING,
                        message=updater.new_agent_message([Part(text=event.text)]),
                        metadata={"kind": "trace"},
                    )
                elif event.kind == "step" and event.step:
                    await updater.add_artifact(
                        [
                            _data_part(
                                {
                                    "step": {
                                        "label": event.step.label,
                                        "done": False,
                                        # Carried across the boundary so a caller
                                        # can say a step will send or delete
                                        # *before* anyone approves it. Dropping
                                        # it here made every step look harmless
                                        # on the wire while the gate, reading the
                                        # graph directly, still fired.
                                        "action": event.step.action,
                                    }
                                }
                            )
                        ],
                        artifact_id=PLAN_ARTIFACT_ID,
                        name="plan",
                        # The first chunk creates the artifact; the rest extend it.
                        append=steps > 0,
                        last_chunk=False,
                    )
                    steps += 1
                elif event.kind == "clarify":
                    clarify = event.clarify
                elif event.kind == "confirm":
                    confirm = event.confirm
                    citations = [_citation_wire(c) for c in event.citations]
                elif event.kind == "note":
                    note = event.text
                    citations = [_citation_wire(c) for c in event.citations]
        except Exception as exc:  # noqa: BLE001 — surfaced as a task state, not a 500
            await updater.failed(
                updater.new_agent_message([Part(text=f"The planner failed: {exc}")])
            )
            return

        # FR-V2. The same protocol state as the Clarify Gate, reached for a
        # different reason: a plan exists, the user has seen every step of it,
        # and nothing runs until they say so. Emitted before the clarify branch
        # because a turn that produced a plan is never also asking a question.
        if confirm is not None:
            await updater.add_artifact(
                [
                    _data_part(
                        {
                            "summary": confirm.get("summary", ""),
                            "options": list(confirm.get("options") or []),
                            "actions": list(confirm.get("actions") or []),
                            "note": note,
                            "trace": trace,
                            "citations": citations,
                            "grounded": bool(citations),
                        }
                    )
                ],
                artifact_id=CONFIRMATION_ARTIFACT_ID,
                name="confirmation",
                append=False,
                last_chunk=True,
            )
            await updater.requires_input(
                updater.new_agent_message([Part(text=confirm.get("summary", ""))])
            )
            return

        # The trace goes out either way: a user is entitled to see why the agent
        # did what it did, including when what it did was refuse to proceed.
        if clarify is not None:
            await updater.add_artifact(
                [
                    _data_part(
                        {
                            "question": clarify.question,
                            "options": list(clarify.options),
                            "trace": trace,
                        }
                    )
                ],
                artifact_id=CLARIFICATION_ARTIFACT_ID,
                name="clarification",
                append=False,
                last_chunk=True,
            )
            # Terminal for this turn, but resumable: the caller answers and the
            # task continues rather than starting over.
            await updater.requires_input(
                updater.new_agent_message([Part(text=clarify.question)])
            )
            return

        await updater.add_artifact(
            [_data_part({"note": note, "trace": trace, "citations": citations, "grounded": bool(citations)})],
            artifact_id=PLAN_ARTIFACT_ID,
            name="plan",
            append=steps > 0,
            last_chunk=True,
        )
        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        # Planning is a single short synchronous step; there is nothing to
        # interrupt. Reporting cancelled would claim we stopped work that had
        # already finished.
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.reject(
            updater.new_agent_message([Part(text="Planning cannot be cancelled mid-turn.")])
        )
