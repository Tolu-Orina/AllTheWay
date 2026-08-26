"""Every connector, what it needs, and whether it exists yet.

One source of truth, on purpose. The consent screen must ask for exactly the
scopes enforcement will later require: if the browser asks for one set and the
gateway checks another, the failure is a user who connected their account and
is still refused, with nothing in either place looking wrong.

The gateway (Node) reads this over HTTP rather than keeping its own copy.

## Scope classification is a shipping constraint, not a detail

Google sorts scopes into three tiers, and the tier decides what it costs to
ship:

  - **non-sensitive** — no review
  - **sensitive** — app verification
  - **restricted** — verification *and* an annual third-party security
    assessment (CASA)

So the tier is chosen here deliberately, and where a capability is only
reachable through a restricted scope, it is marked rather than quietly
requested. `drive.file` instead of `drive.readonly` is the clearest case: it
grants access only to files this app created, which is both less than the user
would otherwise hand over and cheaper to ship.

## The Gmail problem, stated rather than hidden

Reading a mailbox needs `gmail.readonly`, and drafting needs `gmail.compose`.
Both are restricted. So a Gmail connector that only *sends* is shippable, and
one that drafts — which is what the DRAFT_ONLY ceiling wants — is not, without
a security assessment. That is a product decision, not an engineering one, so
the tools are declared and marked and nothing pretends otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class Tier(StrEnum):
    """Google's classification. Decides the cost of going live."""

    NON_SENSITIVE = "non_sensitive"
    SENSITIVE = "sensitive"
    RESTRICTED = "restricted"


class Status(StrEnum):
    AVAILABLE = "available"
    COMING_SOON = "coming_soon"


@dataclass(frozen=True)
class Scope:
    url: str
    tier: Tier
    why: str


@dataclass(frozen=True)
class Connector:
    id: str
    label: str
    provider: str
    status: Status
    summary: str
    #: Scopes needed for the connector's full tool set.
    scopes: tuple[Scope, ...] = ()
    #: Tools that need a scope beyond the base set, and are therefore refused
    #: unless the user granted it. Keyed by tool.
    extra_scopes: dict[str, tuple[Scope, ...]] = field(default_factory=dict)
    #: The service that uses this grant, when it is not this one.
    #:
    #: Almost every connector here is consented to *and* used through this
    #: gateway's MCP servers. Meet is the exception: the user grants it here
    #: because this is where consent lives, and the scribe consumes it because
    #: that is where meetings live. Naming the consumer keeps that legible —
    #: otherwise a connector with no MCP server looks like an oversight, and
    #: the check that would have caught a real oversight has to be weakened to
    #: let it pass.
    served_by: str = ""

    @property
    def scope_urls(self) -> tuple[str, ...]:
        return tuple(s.url for s in self.scopes)


CALENDAR_EVENTS = Scope(
    "https://www.googleapis.com/auth/calendar.events",
    Tier.SENSITIVE,
    "Read and write events on the user's own calendar. Narrower than the full "
    "`calendar` scope, which also exposes calendar settings and sharing.",
)
GMAIL_SEND = Scope(
    "https://www.googleapis.com/auth/gmail.send",
    Tier.SENSITIVE,
    "Send mail as the user. Grants no ability to read the mailbox.",
)
GMAIL_COMPOSE = Scope(
    "https://www.googleapis.com/auth/gmail.compose",
    Tier.RESTRICTED,
    "Create drafts. RESTRICTED: needs a CASA security assessment before "
    "anyone outside the test-user list can consent.",
)
DRIVE_FILE = Scope(
    "https://www.googleapis.com/auth/drive.file",
    Tier.NON_SENSITIVE,
    "Only files this app created. Deliberately not `drive.readonly`, which is "
    "restricted and would expose the user's whole Drive.",
)
DOCUMENTS = Scope(
    "https://www.googleapis.com/auth/documents",
    Tier.SENSITIVE,
    "Read and write document content. Paired with drive.file, this reaches "
    "only documents this app created.",
)
MEETINGS_READONLY = Scope(
    "https://www.googleapis.com/auth/meetings.space.readonly",
    Tier.SENSITIVE,
    "Read the user's meeting spaces and conference records. Read-only by name "
    "and by nature: it grants no ability to start, join or alter a meeting.",
)
MEETINGS_TRANSCRIPT = Scope(
    "https://www.googleapis.com/auth/meetings.space.created",
    Tier.SENSITIVE,
    "Reach conference records and transcripts for meetings, which is what "
    "Tier 1 reads after a call ends. Without it there is no transcript to "
    "read and meetings fall through to having no notes at all.",
)


CONNECTORS: tuple[Connector, ...] = (
    Connector(
        id="google_meet",
        label="Google Meet",
        provider="google",
        status=Status.AVAILABLE,
        summary="Take notes in your meetings. It listens; it cannot speak.",
        # Read-only, deliberately. Nothing here can start, join or alter a
        # meeting — Tier 2's live participation is a separate Developer Preview
        # programme with its own enrolment, not a scope we can request.
        scopes=(MEETINGS_READONLY, MEETINGS_TRANSCRIPT),
        # No MCP server. The scribe holds the meeting record and the tier
        # ladder; routing a transcript read back through here would put the
        # fallback across a network hop for no gain.
        served_by="scribe",
    ),
    Connector(
        id="google_calendar",
        label="Google Calendar",
        provider="google",
        status=Status.AVAILABLE,
        summary="See what is coming up, create events, and invite people.",
        scopes=(CALENDAR_EVENTS,),
    ),
    Connector(
        id="google_gmail",
        label="Gmail",
        provider="google",
        status=Status.AVAILABLE,
        summary="Send mail on your behalf, after you have confirmed it.",
        scopes=(GMAIL_SEND,),
        # Drafting is the behaviour a DRAFT_ONLY ceiling actually wants, and it
        # is the one gated behind a restricted scope. Declared here so the tool
        # is refused with "you did not grant this" rather than silently absent.
        extra_scopes={"create_draft": (GMAIL_COMPOSE,)},
    ),
    Connector(
        id="google_drive",
        label="Google Drive",
        provider="google",
        status=Status.AVAILABLE,
        summary="Save work into your Drive, and find what it saved earlier.",
        scopes=(DRIVE_FILE,),
    ),
    Connector(
        id="google_docs",
        label="Google Docs",
        provider="google",
        status=Status.AVAILABLE,
        summary="Write a deliverable into a document you can open and edit.",
        scopes=(DOCUMENTS, DRIVE_FILE),
    ),
    Connector(
        id="github",
        label="GitHub",
        provider="github",
        status=Status.COMING_SOON,
        summary="Issues and pull requests.",
    ),
    Connector(
        id="notion",
        label="Notion",
        provider="notion",
        status=Status.COMING_SOON,
        summary="Pages and databases.",
    ),
    Connector(
        id="slack",
        label="Slack",
        provider="slack",
        status=Status.COMING_SOON,
        summary="Messages and channels.",
    ),
)

BY_ID: dict[str, Connector] = {c.id: c for c in CONNECTORS}


def get(connector_id: str) -> Connector | None:
    return BY_ID.get(connector_id)


def available(provider: str | None = None) -> tuple[Connector, ...]:
    return tuple(
        c
        for c in CONNECTORS
        if c.status is Status.AVAILABLE and (provider is None or c.provider == provider)
    )


def scopes_for(connector_id: str, tool: str | None = None) -> tuple[str, ...]:
    """Scopes a call needs: the connector's base set, plus any the tool adds."""
    connector = BY_ID.get(connector_id)
    if connector is None:
        return ()
    urls = list(connector.scope_urls)
    if tool:
        urls.extend(s.url for s in connector.extra_scopes.get(tool, ()))
    return tuple(dict.fromkeys(urls))


def consent_scopes(provider: str = "google") -> tuple[str, ...]:
    """Everything the consent screen should ask for, across one provider.

    Asked once rather than per connector. Google issues one refresh token per
    (client, user), and a second authorisation supersedes the first — so
    consenting to Calendar and then to Gmail with separate requests can leave
    the user holding a grant that covers only the later one. Requesting the
    union, with `include_granted_scopes`, is what makes connecting a second
    connector additive instead of destructive.

    Restricted scopes are excluded: they cannot be consented to outside the
    test-user list until a security assessment is done, and including one makes
    the whole consent screen fail rather than just that scope.
    """
    urls: list[str] = []
    for connector in available(provider):
        urls.extend(
            s.url for s in connector.scopes if s.tier is not Tier.RESTRICTED
        )
    return tuple(dict.fromkeys(urls))


def as_json() -> dict:
    """What the gateway serves to the browser, and reads to build a consent URL."""
    return {
        "connectors": [
            {
                "id": c.id,
                "label": c.label,
                "provider": c.provider,
                "status": str(c.status),
                "summary": c.summary,
                "scopes": [
                    {"url": s.url, "tier": str(s.tier), "why": s.why} for s in c.scopes
                ],
                "restrictedTools": sorted(c.extra_scopes),
            }
            for c in CONNECTORS
        ],
        "consentScopes": {"google": list(consent_scopes("google"))},
    }
