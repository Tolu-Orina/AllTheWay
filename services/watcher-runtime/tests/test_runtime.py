"""Runtime behaviour, with the orchestrator stubbed.

The graph itself is tested in the orchestrator's own suite; here we assert what
the runtime does with the answer, which is where the safety rules live.
"""

import app.runtime as runtime
from alltheway_policy import Ceiling, Waiver


def stub_turn(monkeypatch, decision="plan", steps=("Draft the reply",), question="What scope?"):
    def fake(message, preferences):
        if decision == "clarify":
            return {"decision": "clarify", "clarify": {"question": question}}
        return {"decision": "plan", "plan": [{"label": s, "done": False} for s in steps]}

    monkeypatch.setattr(runtime, "_orchestrate", fake)


def watcher(**over):
    base = {
        "name": "Client inquiries",
        "running": True,
        "ceiling": Ceiling.SEND_AFTER_REVIEW.value,
        "action": "send_external",
        "trigger": "New mail matching proposal",
    }
    base.update(over)
    return base


def test_paused_watcher_is_skipped(monkeypatch):
    stub_turn(monkeypatch)
    out = runtime.execute_run(watcher=watcher(running=False), trigger_detail="x", preferences=[])
    assert out.state == "skipped"


def test_irreversible_action_pauses_even_at_the_highest_ceiling(monkeypatch):
    stub_turn(monkeypatch)
    out = runtime.execute_run(
        watcher=watcher(ceiling=Ceiling.SEND_AUTOMATICALLY.value, action="send_external"),
        trigger_detail="x",
        preferences=[],
    )
    assert out.state == "awaiting_review"
    assert "not user-adjustable" in out.reason


def test_reversible_action_completes_at_the_highest_ceiling(monkeypatch):
    stub_turn(monkeypatch)
    out = runtime.execute_run(
        watcher=watcher(ceiling=Ceiling.SEND_AUTOMATICALLY.value, action="create_task"),
        trigger_detail="x",
        preferences=[],
    )
    assert out.state == "done"


def test_ambiguous_trigger_pauses_rather_than_guessing(monkeypatch):
    stub_turn(monkeypatch, decision="clarify", question="Which client is this for?")
    out = runtime.execute_run(watcher=watcher(), trigger_detail="x", preferences=[])
    assert out.state == "awaiting_review"
    assert out.detail == "Which client is this for?"
    assert out.plan == []


def test_admin_waiver_permits_an_irreversible_action(monkeypatch):
    stub_turn(monkeypatch)
    out = runtime.execute_run(
        watcher=watcher(ceiling=Ceiling.SEND_AUTOMATICALLY.value, action="send_external"),
        trigger_detail="x",
        preferences=[],
        waiver=Waiver(granted_by="admin@org.com", justification="Contractual auto-acknowledgement"),
    )
    assert out.state == "done"
