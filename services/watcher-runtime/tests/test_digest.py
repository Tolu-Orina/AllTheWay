"""The sweep decides whether to notify, and nothing else.

The failure worth defending against is not a missing digest — it is a second
one. A duplicate notification at 07:01 reads as the product being broken, and
Pub/Sub delivers at least once by design.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.digest import digest_date


def test_the_date_key_is_utc():
    # A key that changes with the traveller's timezone is a key two services
    # disagree about — the same rule the usage period already follows.
    assert digest_date(datetime(2026, 3, 1, 23, 30, tzinfo=timezone.utc)) == "2026-03-01"
    assert digest_date(datetime(2026, 3, 2, 0, 30, tzinfo=timezone.utc)) == "2026-03-02"


def test_the_sweep_is_bounded():
    """The cap exists so that failing at scale is loud rather than silent.

    Without it, a growing user base turns one request into a timeout halfway
    through, with no record of where it stopped and no digests for whoever came
    after that point.
    """
    from app.digest import MAX_USERS_PER_SWEEP

    assert isinstance(MAX_USERS_PER_SWEEP, int)
    assert MAX_USERS_PER_SWEEP > 0


def test_nothing_waiting_means_no_notification(monkeypatch):
    """A daily interruption that says "nothing to do" is how notifications get
    switched off — and once off, the ones that matter never arrive either."""
    from app import push

    sent = []
    monkeypatch.setattr(push, "tokens_for", lambda uid: ["token-1"])
    monkeypatch.setattr(push, "PROJECT", "test-project")
    monkeypatch.setattr(push, "_token", lambda: (_ for _ in ()).throw(AssertionError("authenticated for an empty digest")))

    # waiting == 0 must return before any credential is fetched.
    assert push.send_digest("u", 0) == 0
    assert sent == []


def test_a_user_with_no_devices_is_not_an_error(monkeypatch):
    from app import push

    monkeypatch.setattr(push, "PROJECT", "test-project")
    monkeypatch.setattr(push, "tokens_for", lambda uid: [])
    assert push.send_digest("u", 3) == 0


def test_the_notification_says_what_is_waiting(monkeypatch):
    """"You have a new digest" is not actionable from a lock screen; "2 things
    need your decision" is. A notification that says nothing specific trains
    people to swipe it away, and then they swipe away the ones that matter.

    Asserted on the payload that would actually be sent, not on the source —
    an earlier version of this test read the module text and failed on the
    docstring that names the anti-pattern.
    """
    from app import push

    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            captured.update(json or {})
            return FakeResponse()

    monkeypatch.setattr(push, "PROJECT", "test-project")
    monkeypatch.setattr(push, "tokens_for", lambda uid: ["token-1"])
    monkeypatch.setattr(push, "_token", lambda: "fake-access-token")
    monkeypatch.setattr(push.httpx, "Client", FakeClient)

    reached = push.send_digest("u", 2)

    assert reached == 1
    body = captured["message"]["data"]["body"]
    assert body == "2 things need your decision."

    # Sent as data rather than a notification block: our own service worker
    # renders it, so a payload cannot set options the worker did not intend.
    assert "notification" not in captured["message"]


def test_one_waiting_item_is_not_pluralised(monkeypatch):
    from app import push

    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            captured.update(json or {})
            return FakeResponse()

    monkeypatch.setattr(push, "PROJECT", "test-project")
    monkeypatch.setattr(push, "tokens_for", lambda uid: ["token-1"])
    monkeypatch.setattr(push, "_token", lambda: "fake-access-token")
    monkeypatch.setattr(push.httpx, "Client", FakeClient)

    push.send_digest("u", 1)
    assert captured["message"]["data"]["body"] == "1 thing needs your decision."


def test_a_dead_token_is_forgotten_not_retried_forever(monkeypatch):
    """Kept, a dead registration makes every future send report a failure — and
    a send that always reports failures is a send nobody reads."""
    from app import push

    forgotten = []

    class FakeResponse:
        status_code = 404
        text = '{"error": {"details": [{"errorCode": "UNREGISTERED"}]}}'

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            return FakeResponse()

    monkeypatch.setattr(push, "PROJECT", "test-project")
    monkeypatch.setattr(push, "tokens_for", lambda uid: ["dead-token"])
    monkeypatch.setattr(push, "_token", lambda: "fake-access-token")
    monkeypatch.setattr(push.httpx, "Client", FakeClient)
    monkeypatch.setattr(push, "_forget", lambda uid, token: forgotten.append(token))

    assert push.send_digest("u", 1) == 0
    assert forgotten == ["dead-token"]


def test_a_transient_failure_keeps_the_token(monkeypatch):
    """Quota and unavailability are not "this browser is gone". Deleting on a
    503 would quietly unsubscribe people during an outage."""
    from app import push

    forgotten = []

    class FakeResponse:
        status_code = 503
        text = "backend unavailable"

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            return FakeResponse()

    monkeypatch.setattr(push, "PROJECT", "test-project")
    monkeypatch.setattr(push, "tokens_for", lambda uid: ["live-token"])
    monkeypatch.setattr(push, "_token", lambda: "fake-access-token")
    monkeypatch.setattr(push.httpx, "Client", FakeClient)
    monkeypatch.setattr(push, "_forget", lambda uid, token: forgotten.append(token))

    assert push.send_digest("u", 1) == 0
    assert forgotten == []
