"""Connector credentials.

Architecture §7 and plan item 4: credentials live in Secret Manager, never in
environment variables.

## Why not environment variables

An env var is visible to every process in the container, appears in crash
dumps and process listings, is printed by well-meaning debug logging, and is
baked into a Cloud Run revision — so rotating it means a deploy, and the old
value stays in revision history. None of that is true of a secret fetched at
use, by an identity that can be audited and revoked.

Cloud Run *can* mount secrets as env vars, which looks like the best of both.
It is not: it converts a secret into exactly the thing above at container start,
and loses the audit trail of who read it and when.

## The cache

Secrets are cached briefly. Without it, a connector that makes several calls
fetches the same secret several times, which is slow and noisy in the audit log.
With a long TTL, rotation takes effect whenever the container happens to
restart, which is not a rotation policy. Minutes is the compromise.

## Fail closed

An unavailable secret means the connector does not run. It never falls back to
an environment variable — a fallback path is the path an attacker arranges to
be taken.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Protocol


class SecretUnavailable(RuntimeError):
    """The secret could not be read. The caller must not proceed without it."""


class SecretSource(Protocol):
    name: str

    def fetch(self, secret: str) -> str: ...


@dataclass
class _Cached:
    value: str
    expires_at: float


#: Long enough to serve a burst of connector calls, short enough that a rotated
#: secret takes effect without a deploy.
TTL_SECONDS = 300


class SecretManagerSource:
    """Google Secret Manager, read with the service's own ADC identity.

    `secret` is a secret *id* (as Terraform passes it) or a full resource
    name. The value is fetched at the moment of use — never mounted as an
    env var, which is the whole point of this module.
    """

    name = "secret-manager"

    def __init__(self, project: str, *, client: object | None = None) -> None:
        self.project = project
        self._client = client

    def fetch(self, secret: str) -> str:
        name = secret.strip()
        if not name:
            raise SecretUnavailable("A secret name is required.")
        if not name.startswith("projects/"):
            name = f"projects/{self.project}/secrets/{name}/versions/latest"
        elif "/versions/" not in name:
            name = f"{name}/versions/latest"

        try:
            response = self._sm().access_secret_version(request={"name": name})
        except SecretUnavailable:
            raise
        except Exception as exc:
            raise SecretUnavailable(f"Could not read {secret!r}.") from exc

        payload = getattr(getattr(response, "payload", None), "data", None)
        if payload is None:
            raise SecretUnavailable(f"Secret {secret!r} has no payload.")
        if isinstance(payload, bytes):
            value = payload.decode("UTF-8").strip()
        else:
            value = str(payload).strip()
        if not value:
            raise SecretUnavailable(f"Secret {secret!r} is empty.")
        return value

    def _sm(self):
        if self._client is None:
            # Imported lazily so tests that never fetch do not need the client
            # library on the path, matching FirestoreRefreshTokens.
            from google.cloud import secretmanager

            self._client = secretmanager.SecretManagerServiceClient()
        return self._client


class DevFileSource:
    """Local development only: reads from a gitignored file.

    A file rather than an env var even here, so the development path has the
    same shape as the real one — you fetch a secret by name, at the moment you
    need it, and it can fail. A dev path that works differently is a dev path
    that hides the failure modes.
    """

    name = "dev-file"

    def __init__(self, directory: str) -> None:
        self.directory = directory

    def fetch(self, secret: str) -> str:
        path = os.path.join(self.directory, secret)
        try:
            with open(path, encoding="utf-8") as handle:
                return handle.read().strip()
        except OSError as exc:
            raise SecretUnavailable(f"No local secret {secret!r} in {self.directory}.") from exc


def create_source() -> SecretSource:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
    if project and os.environ.get("USE_SECRET_MANAGER") == "true":
        return SecretManagerSource(project)
    return DevFileSource(os.environ.get("DEV_SECRETS_DIR", ".secrets"))


_cache: dict[str, _Cached] = {}


def get(secret: str, source: SecretSource | None = None, now: float | None = None) -> str:
    """Fetch a secret, cached briefly. Raises rather than returning a default."""
    chosen = source or create_source()
    clock = now if now is not None else time.monotonic()

    hit = _cache.get(secret)
    if hit and hit.expires_at > clock:
        return hit.value

    value = chosen.fetch(secret)  # SecretUnavailable propagates: no fallback.
    _cache[secret] = _Cached(value=value, expires_at=clock + TTL_SECONDS)
    return value


def forget(secret: str | None = None) -> None:
    """Drop cached values, so a rotation can be applied without a restart."""
    if secret is None:
        _cache.clear()
    else:
        _cache.pop(secret, None)
