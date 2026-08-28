"""Bridges A2A to the connector layer.

    allowed        ->  result artifact, TASK_STATE_COMPLETED
    refused        ->  refusal artifact, TASK_STATE_REJECTED
    needs a human  ->  TASK_STATE_INPUT_REQUIRED

The third one matters. A side-effecting call arriving without confirmation is
not an error and not a failure — it is the system working. `INPUT_REQUIRED` is
the same state the Clarify Gate and the confirm gate use, for the same reason:
the turn stops and needs a person before anything happens. A caller that already
speaks A2A handles it without learning anything new.

`REJECTED` is reserved for calls that cannot be fixed by answering: out of
scope, rate limited, unregistered. Returning those as INPUT_REQUIRED would
invite a caller to ask a user to approve something that will be refused anyway.

## The request is JSON, not prose

A connector call is structured — connector, tool, arguments — so it arrives as a
data part rather than text. There is nothing here for a model to interpret, and
accepting prose would mean parsing intent at the one boundary that must not
guess.
"""

from __future__ import annotations

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import Part, Task, TaskState, TaskStatus
from google.protobuf import json_format, struct_pb2

from alltheway_policy import Ceiling, Waiver

from .enforcement import Grant, Refusal, Usage
from .service import invoke
from .oauth import FirestoreRefreshTokens, RefreshTokenStore
from alltheway_metering import Meter

from .org_policy import FirestorePolicies, PolicyStore
from .registry import meter_for
from .visual import VisualStore, default_visual_store
from .subscription import SubscriptionStore, default_store
from .usage import UsageStore


def _default_policy_store() -> PolicyStore | None:
    """Firestore in a deployed service, nothing locally.

    None means every org resolves to the strict default, which is the correct
    behaviour when policy cannot be read: absent policy is the strictest
    policy, never the loosest.
    """
    import os

    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return None
    try:
        return FirestorePolicies()
    except Exception:  # pragma: no cover - absent client or credentials
        return None


def _default_token_store() -> RefreshTokenStore | None:
    """Firestore in a deployed service, nothing locally.

    Returning None rather than an in-memory stand-in is deliberate: a store
    that answers from memory would let a connector look connected when no
    grant exists, which is the one thing this must never do.
    """
    import os

    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return None
    try:
        return FirestoreRefreshTokens()
    except Exception:  # pragma: no cover - absent client or credentials
        return None

RESULT_ARTIFACT_ID = "result"
REFUSAL_ARTIFACT_ID = "refusal"

#: Refusals a user could clear by saying yes. Everything else is terminal.
#: Refusals a human can resolve. NEEDS_CONSENT joins NOT_CONFIRMED because
#: "connect your calendar" is an answerable request, not a dead end — the spec
#: has TASK_STATE_AUTH_REQUIRED for exactly this, and mapping it to REJECTED
#: would tell the caller to give up on something one click fixes.
_ANSWERABLE = {Refusal.NOT_CONFIRMED, Refusal.NEEDS_CONSENT}


def _data_part(payload: dict) -> Part:
    value = struct_pb2.Value()
    json_format.ParseDict(payload, value)
    return Part(data=value)


def _request_of(context: RequestContext) -> dict:
    """The structured call, from the message's data part."""
    message = getattr(context, "message", None)
    for part in getattr(message, "parts", []) or []:
        if part.WhichOneof("content") == "data":
            return json_format.MessageToDict(part.data)
    return {}


def _grant_from(payload: dict) -> Grant | None:
    """The user's grant, as the caller reports it.

    Trusted from the caller today because grants live in the gateway's Firestore
    and this service has no database. That is a real limitation, not a design:
    it means a compromised caller could widen its own scope. What it cannot do
    is widen the *floor* — confirmation and the irreversible-action rule are
    enforced here regardless of what the grant says.
    """
    raw = payload.get("grant")
    if not isinstance(raw, dict):
        return None
    try:
        return Grant(
            connector=str(raw["connector"]),
            tools=frozenset(str(t) for t in raw.get("tools", [])),
            ceiling=Ceiling(raw.get("ceiling", "draft_only")),
            per_minute=int(raw.get("perMinute", 30)),
            per_day=int(raw.get("perDay", 500)),
        )
    except (KeyError, ValueError):
        # An unparseable grant is no grant. Never a permissive default.
        return None


class ConnectorExecutor(AgentExecutor):
    def __init__(
        self,
        usage: UsageStore | None = None,
        token_store: "RefreshTokenStore | None" = None,
        policy_store: "PolicyStore | None" = None,
        subscriptions: "SubscriptionStore | None" = None,
        visual: "VisualStore | None" = None,
    ) -> None:
        self._usage = usage or UsageStore()
        # Built lazily and only when a connector actually needs it, so neither
        # the tests nor the in-memory connector path require Firestore.
        self._token_store = token_store or _default_token_store()
        self._policy_store = policy_store or _default_policy_store()
        self._subscriptions = subscriptions or default_store()
        self._visual = visual or default_visual_store()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
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

        payload = _request_of(context)
        connector = str(payload.get("connector", "")).strip()
        tool = str(payload.get("tool", "")).strip()

        if not connector or not tool:
            await updater.failed(
                updater.new_agent_message(
                    [Part(text="A connector call needs both 'connector' and 'tool'.")]
                )
            )
            return

        user = context.tenant or "user"
        key = (user, connector)

        waiver_raw = payload.get("waiver")
        waiver = (
            Waiver(
                granted_by=str(waiver_raw.get("grantedBy", "")),
                justification=str(waiver_raw.get("justification", "")),
            )
            if isinstance(waiver_raw, dict)
            else None
        )

        outcome = await invoke(
            connector=connector,
            tool=tool,
            arguments=payload.get("arguments") or {},
            grant=_grant_from(payload),
            usage=self._usage.usage(key),
            confirmed=bool(payload.get("confirmed", False)),
            # A separate field from `confirmed`, and separate on the wire too.
            # Deriving one from the other anywhere along this path would undo
            # the distinction the two gates exist to make.
            cost_acknowledged=bool(payload.get("costAcknowledged", False)),
            waiver=waiver,
            user=user,
            token_store=self._token_store,
            # The organisation this call belongs to. Sent by the caller, which
            # is the only party that knows it — the connector gateway sees a
            # user id, not a directory. Absent means the strict default.
            org=str(payload.get("org", "")).strip(),
            policy_store=self._policy_store,
            subscriptions=self._subscriptions,
            visual=self._visual,
        )

        if outcome.ok:
            # Counted only when it actually ran. Charging for refused calls
            # would let a caller exhaust its own quota by being denied.
            self._usage.record(key)
            # Metered only on success, for the same reason as the per-connector
            # quota above: charging for refused calls would let a caller
            # exhaust its own allowance by being denied.
            if self._subscriptions is not None:
                specific = meter_for(connector, tool)
                if not (connector == "media" and tool == "poll_draft_video"):
                    self._subscriptions.record(user, Meter.CONNECTOR_CALLS, 1)

                # A tool with its own meter also charges that. Video charges
                # per second, because a six-second draft and a six-second final
                # differ by fifteen times in cost and the meter has to reflect
                # what was actually spent.
                if specific is not None:
                    seconds = int((payload.get("arguments") or {}).get("seconds", 1))
                    amount = max(seconds, 1) if "video" in tool else 1
                    self._subscriptions.record(user, Meter(specific), amount)
            await updater.add_artifact(
                [_data_part({"data": outcome.data, "trace": outcome.trace})],
                artifact_id=RESULT_ARTIFACT_ID,
                name="result",
                append=False,
                last_chunk=True,
            )
            await updater.complete()
            return

        await updater.add_artifact(
            [
                _data_part(
                    {
                        "refusal": outcome.refusal.value if outcome.refusal else "unavailable",
                        "reason": outcome.reason,
                        "error": outcome.reason,
                        "trace": outcome.trace,
                        **({"data": outcome.data} if outcome.data else {}),
                    }
                )
            ],
            artifact_id=REFUSAL_ARTIFACT_ID,
            name="refusal",
            append=False,
            last_chunk=True,
        )

        if outcome.refusal in _ANSWERABLE:
            await updater.requires_input(
                updater.new_agent_message([Part(text=outcome.reason)])
            )
        else:
            await updater.reject(updater.new_agent_message([Part(text=outcome.reason)]))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.reject(
            updater.new_agent_message(
                [Part(text="A connector call is a single round trip; there is nothing to cancel.")]
            )
        )
