"""Publish a watcher-trigger message.

The due-scan and the session-ended fan-out both enqueue work this way rather
than calling execute_run in-process: the existing /events handler is already
idempotent on runId, already screens, and already writes the run row. Two
producers, one consumer.
"""

from __future__ import annotations

import json
import os
from typing import Any

from .firestore import PROJECT

_publisher = None


def trigger_topic() -> str:
    name = os.environ.get("WATCHER_TRIGGER_TOPIC", "watcher-trigger")
    if name.startswith("projects/"):
        return name
    return f"projects/{PROJECT}/topics/{name}"


def publish_trigger(payload: dict[str, Any]) -> str:
    """Returns the Pub/Sub message id. Tests monkeypatch this."""
    global _publisher
    from google.cloud import pubsub_v1

    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    future = _publisher.publish(trigger_topic(), json.dumps(payload).encode("utf-8"))
    return future.result(timeout=30)


def trigger_topic() -> str:
    name = os.environ.get("WATCHER_TRIGGER_TOPIC", "watcher-trigger")
    if name.startswith("projects/"):
        return name
    return f"projects/{PROJECT}/topics/{name}"


def publish_trigger(payload: dict[str, Any]) -> str:
    """Returns the Pub/Sub message id. Tests monkeypatch this."""
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    future = _publisher.publish(trigger_topic(), json.dumps(payload).encode("utf-8"))
    return future.result(timeout=30)
