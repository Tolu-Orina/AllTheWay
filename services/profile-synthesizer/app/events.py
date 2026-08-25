"""Pub/Sub push envelopes.

Cloud Run receives events as an HTTP POST from Pub/Sub, not by pulling. Parsing
that envelope here means the service has exactly the same shape locally as in
production — the only difference is what puts the message on the wire.
"""

from __future__ import annotations

import base64
import json
from typing import Any

from pydantic import BaseModel


class PubSubMessage(BaseModel):
    data: str | None = None
    messageId: str | None = None
    attributes: dict[str, str] = {}


class PushEnvelope(BaseModel):
    message: PubSubMessage
    subscription: str | None = None

    def payload(self) -> dict[str, Any]:
        """Decode the base64 body. A malformed body is an empty dict, never a crash."""
        if not self.message.data:
            return {}
        try:
            return json.loads(base64.b64decode(self.message.data).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def delivery_id(self) -> str:
        """Pub/Sub is at-least-once, so handlers must key idempotency on this."""
        return self.message.messageId or ""
