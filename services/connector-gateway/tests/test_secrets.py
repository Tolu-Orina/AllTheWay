"""Credentials: fetched by name, at the moment they are needed, never defaulted."""

import pytest

from app import secrets
from app.secrets import DevFileSource, SecretManagerSource, SecretUnavailable, get


class Counting:
    name = "counting"

    def __init__(self, value="s3cret"):
        self.value, self.calls = value, 0

    def fetch(self, secret):
        self.calls += 1
        return self.value


@pytest.fixture(autouse=True)
def clean_cache():
    secrets.forget()
    yield
    secrets.forget()


def test_a_missing_secret_raises_rather_than_returning_empty():
    with pytest.raises(SecretUnavailable):
        get("calendar_oauth", source=DevFileSource("/definitely/not/here"))


def test_an_unavailable_secret_never_falls_back_to_an_environment_variable(monkeypatch):
    """A fallback path is the path an attacker arranges to be taken."""
    monkeypatch.setenv("calendar_oauth", "from-the-environment")
    with pytest.raises(SecretUnavailable):
        get("calendar_oauth", source=DevFileSource("/definitely/not/here"))


class _FakeSecretClient:
    def __init__(self, payload=b"from-sm", names=None):
        self.payload = payload
        self.names = names if names is not None else []

    def access_secret_version(self, request):
        self.names.append(request["name"])
        if isinstance(self.payload, Exception):
            raise self.payload
        payload = self.payload

        class Payload:
            data = payload

        class Resp:
            payload = Payload()

        return Resp()


def test_secret_manager_reads_the_payload_by_secret_id():
    client = _FakeSecretClient(b"  token-from-sm \n")
    source = SecretManagerSource("alltheway-rinegan", client=client)
    assert source.fetch("google_oauth_client_id") == "token-from-sm"
    assert client.names == [
        "projects/alltheway-rinegan/secrets/google_oauth_client_id/versions/latest"
    ]


def test_secret_manager_accepts_a_full_resource_name():
    client = _FakeSecretClient(b"id-value")
    source = SecretManagerSource("p", client=client)
    name = "projects/p/secrets/google_oauth_client_id/versions/latest"
    assert source.fetch(name) == "id-value"
    assert client.names == [name]


def test_secret_manager_a_missing_secret_raises_rather_than_returning_empty():
    client = _FakeSecretClient(payload=RuntimeError("404"))
    with pytest.raises(SecretUnavailable):
        SecretManagerSource("p", client=client).fetch("calendar_oauth")


def test_secret_manager_never_falls_back_to_an_environment_variable(monkeypatch):
    monkeypatch.setenv("google_oauth_client_id", "from-the-environment")
    client = _FakeSecretClient(payload=RuntimeError("denied"))
    with pytest.raises(SecretUnavailable):
        SecretManagerSource("p", client=client).fetch("google_oauth_client_id")


def test_repeat_reads_inside_the_ttl_are_served_from_cache():
    source = Counting()
    assert get("k", source=source, now=100.0) == "s3cret"
    assert get("k", source=source, now=100.0 + secrets.TTL_SECONDS - 1) == "s3cret"
    assert source.calls == 1


def test_the_cache_expires_so_a_rotation_takes_effect():
    source = Counting()
    get("k", source=source, now=100.0)
    get("k", source=source, now=100.0 + secrets.TTL_SECONDS + 1)
    assert source.calls == 2


def test_a_rotation_can_be_applied_without_waiting():
    source = Counting()
    get("k", source=source, now=100.0)
    secrets.forget("k")
    get("k", source=source, now=100.0)
    assert source.calls == 2


def test_the_local_source_reads_a_file(tmp_path):
    (tmp_path / "calendar_oauth").write_text("  token-from-file \n", encoding="utf-8")
    assert get("calendar_oauth", source=DevFileSource(str(tmp_path))) == "token-from-file"
