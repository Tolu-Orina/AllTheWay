"""Due-scan behaviour, with Pub/Sub and Firestore stubbed.

The load-bearing rules: a due row is published before nextRunAt moves, the
runId is derived from the due instant (so a retry is the same run), and the
instruction never rides on the index.
"""

from datetime import datetime, timedelta, timezone

from app.due import MIN_INTERVAL_MINUTES, run_id, scan_due, fanout_session_ended, scan_reminders


class FakeRef:
    def __init__(self, data: dict):
        self.data = data
        self.deleted = False

    def update(self, fields: dict) -> None:
        self.data.update(fields)

    def delete(self) -> None:
        self.deleted = True


class FakeSnap:
    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self._data = data
        self.reference = FakeRef(data)

    def to_dict(self) -> dict:
        return self._data


class FakeQuery:
    def __init__(self, rows: list[FakeSnap]):
        self._rows = rows

    def where(self, *args, **kwargs):
        return self

    def limit(self, _n):
        return self

    def stream(self):
        return iter(self._rows)


class FakeCollection:
    def __init__(self, rows: list[FakeSnap]):
        self._rows = rows

    def where(self, *args, **kwargs):
        return FakeQuery(self._rows)


def test_run_id_is_stable_for_the_same_due_instant():
    due = datetime(2026, 8, 27, 7, 0, tzinfo=timezone.utc)
    assert run_id("w1", due) == run_id("w1", due)
    assert "w1+" in run_id("w1", due)


def test_due_scan_publishes_then_advances(monkeypatch):
    due = datetime(2026, 8, 27, 7, 0, tzinfo=timezone.utc)
    row = {
        "uid": "user-a",
        "watcherId": "w1",
        "running": True,
        "intervalMinutes": 1440,
        "nextRunAt": due,
    }
    published = []

    import app.due as due_mod

    monkeypatch.setattr(due_mod, "db", type("DB", (), {"collection": lambda self, name: FakeCollection([FakeSnap("user-a_w1", row)])})())
    monkeypatch.setattr(due_mod, "publish_trigger", lambda payload: published.append(payload) or "mid")

    out = scan_due(now=due + timedelta(minutes=1))
    assert out["enqueued"] == 1
    assert published[0]["userId"] == "user-a"
    assert published[0]["watcherId"] == "w1"
    assert published[0]["runId"] == run_id("w1", due)
    assert row["nextRunAt"] == due + timedelta(minutes=1440)


def test_a_row_with_instruction_is_refused(monkeypatch):
    due = datetime(2026, 8, 27, 7, 0, tzinfo=timezone.utc)
    row = {
        "uid": "user-a",
        "watcherId": "w1",
        "running": True,
        "intervalMinutes": 1440,
        "nextRunAt": due,
        "instruction": "draft the inbox",
    }
    published = []
    import app.due as due_mod

    monkeypatch.setattr(due_mod, "db", type("DB", (), {"collection": lambda self, name: FakeCollection([FakeSnap("user-a_w1", row)])})())
    monkeypatch.setattr(due_mod, "publish_trigger", lambda payload: published.append(payload))

    out = scan_due(now=due + timedelta(minutes=1))
    assert out["enqueued"] == 0
    assert out["failed"] == 1
    assert published == []


def test_interval_floor_is_an_hour():
    assert MIN_INTERVAL_MINUTES == 60


def test_session_ended_fans_out_only_matching_watchers(monkeypatch):
    published = []

    class Store:
        def stream(self):
            return iter(
                [
                    FakeSnap("sched", {"running": True, "triggerKind": "schedule"}),
                    FakeSnap("ended", {"running": True, "triggerKind": "session_ended"}),
                    FakeSnap("paused", {"running": False, "triggerKind": "session_ended"}),
                ]
            )

    import app.due as due_mod

    monkeypatch.setattr(due_mod, "watchers", lambda uid: Store())
    monkeypatch.setattr(due_mod, "publish_trigger", lambda payload: published.append(payload) or "mid")

    out = fanout_session_ended("user-a", "sess-1")
    assert out["enqueued"] == 1
    assert published[0]["watcherId"] == "ended"
    assert published[0]["sessionId"] == "sess-1"
    assert published[0]["runId"] == "ended+sess-1"


def test_reminder_scan_fires_leave_then_drops_the_pointer(monkeypatch):
    due = datetime(2026, 8, 28, 8, 10, tzinfo=timezone.utc)
    pointer = {
        "uid": "user-a",
        "reminderId": "r1",
        "fireAt": due,
        "kind": "leave",
    }
    reminder = {"title": "pickup", "state": "scheduled"}
    sent = []
    snap = FakeSnap("user-a_r1", pointer)

    class ReminderSnap:
        exists = True

        def to_dict(self):
            return reminder

    class ReminderRef:
        def get(self):
            return ReminderSnap()

        def update(self, fields):
            reminder.update(fields)

    class Reminders:
        def document(self, _id):
            return ReminderRef()

    import app.firestore as fs
    import app.push as push_mod

    monkeypatch.setattr(fs, "reminder_due", lambda: FakeCollection([snap]))
    monkeypatch.setattr(fs, "reminders", lambda uid: Reminders())
    monkeypatch.setattr(push_mod, "send_leave", lambda uid, title, minutes: sent.append((uid, title, minutes)) or 1)

    out = scan_reminders(now=due)
    assert out["fired"] == 1
    assert sent == [("user-a", "pickup", 0)]
    assert reminder["state"] == "fired"
    assert snap.reference.deleted is True
