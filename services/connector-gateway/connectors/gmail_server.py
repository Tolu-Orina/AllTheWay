"""Gmail, as an MCP server.

Send only, plus drafting where the user has granted it.

## Why this connector cannot read your mail

Reading a mailbox needs `gmail.readonly`, which Google classifies as
**restricted**: an app requesting it needs verification *and* an annual
third-party security assessment before anyone outside the test-user list can
consent. `gmail.send` is merely sensitive, so a connector that sends is
shippable and one that reads is not.

That is a deliberate line, not an oversight. It also means the Watcher trigger
that reads inbound email cannot be Gmail today.

## Drafting is behind a restricted scope too

`create_draft` needs `gmail.compose`, also restricted — which is awkward,
because a draft is the *safest* thing this connector does and is exactly what a
DRAFT_ONLY ceiling wants. The tool is declared anyway: the gateway checks the
user's granted scopes before calling, so it is refused with "you have not
granted this" rather than being silently absent.
"""

from __future__ import annotations

import base64
from email.message import EmailMessage

from mcp.server.fastmcp import FastMCP

from _google import capped, fail, message_from, ok, request  # noqa: F401

mcp = FastMCP("alltheway-gmail")

API = "https://gmail.googleapis.com/gmail/v1/users/me"


def _raw(to: str, subject: str, body: str) -> str:
    """RFC 2822, base64url. Built with the stdlib rather than by hand.

    Header injection is the failure here: a newline inside `subject` would
    otherwise let a caller add its own headers — a Bcc, say — and the message
    would still send perfectly. EmailMessage refuses that.
    """
    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    return base64.urlsafe_b64encode(message.as_bytes()).decode()


@mcp.tool()
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email as the user. This reaches a third party and is final."""
    try:
        raw = _raw(to, subject, body)
    except ValueError as exc:
        # EmailMessage rejects a header carrying a newline. Report it as a
        # refusal rather than letting it escape as a transport error.
        return fail(f"That message could not be built safely: {exc}")

    status, payload = request("POST", f"{API}/messages/send", json={"raw": raw})
    if status not in (200, 201):
        return fail(message_from(payload, "Could not send the message."), status=status)
    return ok(sent=True, id=payload.get("id"))


@mcp.tool()
def create_draft(to: str, subject: str, body: str) -> str:
    """Save a draft in the user's mailbox. Sends nothing."""
    try:
        raw = _raw(to, subject, body)
    except ValueError as exc:
        return fail(f"That message could not be built safely: {exc}")

    status, payload = request(
        "POST", f"{API}/drafts", json={"message": {"raw": raw}}
    )
    if status not in (200, 201):
        # 403 here is the expected answer when the user granted gmail.send but
        # not the restricted gmail.compose. Google's own message says so, and
        # it is more useful than one this module invents.
        return fail(message_from(payload, "Could not save the draft."), status=status)
    return ok(draft=True, id=payload.get("id"))


if __name__ == "__main__":
    mcp.run()
