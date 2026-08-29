"""The model's own action labelling is not trusted.

## The measurement this exists because of

Both candidate models were asked to plan explicitly risky requests — "pay the
invoice", "delete the draft and send the final" — and each marked an
irreversible step in only **8 of 12 runs**. A third of the time the plan came
back with `action: ""` on a step that would send money or destroy something,
and FR-V2's confirm gate reads that field. No label, no gate, no question: the
user is never asked.

Switching models does not fix it — the two were identical on this. The layered
design still holds at the point of *effect*, because the connector gateway
classifies severity from its own registry and refuses an unconfirmed
irreversible call regardless. What is lost is the **warning**, which is the part
the user actually sees, and the part FR-V2 is about.

So the label is treated as a claim to be checked rather than a fact.

## Escalate only, never downgrade

This pass can raise a step's severity and never lower it. That asymmetry is the
whole safety argument: a model that under-labels gets corrected, while a model
that over-labels — or an attacker who gets text into a plan — cannot talk the
gate *out* of firing. The worst this can do is ask the user about something
harmless. The worst the alternative does is move money silently.

## It is a floor, and says so

This is verb matching over the step's own text. It will miss a phrasing nobody
listed, and it will occasionally fire on "draft the note without sending it" —
which escalates to a confirmation the user can decline in one click. Both
failure modes point the same way, which is why matching is acceptable here and
would not be as the only line of defence.
"""

from __future__ import annotations

import re

from alltheway_policy import Action

from .models import PlanStep

#: Most severe first. A step matching several is judged by the worst, because
#: "email the vendor and pay the invoice" is a payment that also sends mail.
#:
#: Verbs, not nouns. "payment" appears in "the payment was received", which
#: reports a fact; "pay" is someone about to do something.
_SIGNALS: tuple[tuple[Action, tuple[str, ...]], ...] = (
    (
        Action.MAKE_PAYMENT,
        ("pay", "pays", "paying", "wire", "wires", "wiring", "transfer",
         "transfers", "transferring", "refund", "refunds", "charge", "charges",
         "purchase", "purchases", "buy", "buys", "invoice", "invoices",
         "checkout", "subscribe", "renew"),
    ),
    (
        Action.DELETE_DATA,
        ("delete", "deletes", "deleting", "remove", "removes", "removing",
         "erase", "erases", "wipe", "wipes", "discard", "discards", "purge",
         "purges", "revoke", "revokes", "cancel", "cancels", "cancelling",
         "unsubscribe", "drop", "drops"),
    ),
    (
        Action.SEND_EXTERNAL,
        ("send", "sends", "sending", "email", "emails", "emailing", "reply",
         "replies", "forward", "forwards", "forwarding", "publish", "publishes",
         "post", "posts", "posting", "share", "shares", "sharing", "invite",
         "invites", "notify", "notifies", "submit", "submits", "message",
         "messages", "announce", "broadcast"),
    ),
    (
        Action.UPDATE_RECORD,
        ("update", "updates", "updating", "edit", "edits", "editing", "change",
         "changes", "changing", "rename", "renames", "modify", "modifies",
         "move", "moves", "reschedule", "reschedules", "assign", "assigns",
         "overwrite", "overwrites", "replace", "replaces"),
    ),
    (
        Action.CREATE_TASK,
        ("create", "creates", "creating", "add", "adds", "adding", "schedule",
         "schedules", "scheduling", "book", "books", "booking", "file", "files",
         "raise", "raises", "register", "registers"),
    ),
    (
        Action.DRAFT,
        ("draft", "drafts", "drafting", "compose", "composes", "write",
         "writes", "writing", "prepare", "prepares"),
    ),
)

#: Ranked lowest to highest, so two labels can be compared.
_SEVERITY: dict[Action, int] = {
    Action.DRAFT: 1,
    Action.CREATE_TASK: 2,
    Action.UPDATE_RECORD: 3,
    Action.SEND_EXTERNAL: 4,
    Action.DELETE_DATA: 5,
    Action.MAKE_PAYMENT: 6,
}

_PATTERNS: tuple[tuple[Action, re.Pattern[str]], ...] = tuple(
    # Word boundaries, so "sender" is not "send" and "updated" is matched by
    # "updates" only if listed. Without them "post" fires on "postpone".
    (action, re.compile(r"\b(?:%s)\b" % "|".join(map(re.escape, words)), re.I))
    for action, words in _SIGNALS
)


def _parse(label: str) -> Action | None:
    """The strongest action the step's own words imply, if any."""
    for action, pattern in _PATTERNS:
        if pattern.search(label):
            return action
    return None


def _declared(step: PlanStep) -> Action | None:
    """What the model said, or None when it said nothing usable.

    An unrecognised string is deliberately *not* treated as None here: models.py
    already documents that an unknown action is handled as the most severe case
    downstream, and quietly discarding it would undo that.
    """
    if not step.action:
        return None
    try:
        return Action(step.action)
    except ValueError:
        return Action.MAKE_PAYMENT


def validate(steps: list[PlanStep]) -> tuple[list[PlanStep], list[str]]:
    """Return the plan with under-labelled steps corrected, and what changed.

    The notes are for the trace. A step that was silently reclassified is a
    thing the system did to the user's plan, and the architecture's rule is
    that anything an agent decides must be explicable to the person it happened
    to — so the correction is stated, not hidden.
    """
    corrected: list[PlanStep] = []
    notes: list[str] = []

    for step in steps:
        implied = _parse(step.label)
        declared = _declared(step)

        if implied is None:
            corrected.append(step)
            continue

        # Escalate only. A declared action at or above what the words imply is
        # left exactly as the model set it.
        if declared is not None and _SEVERITY[declared] >= _SEVERITY[implied]:
            corrected.append(step)
            continue

        corrected.append(step.model_copy(update={"action": str(implied)}))
        notes.append(
            f"Marked {step.label!r} as {implied} — the plan did not say so, "
            f"and the wording says it changes something."
            if declared is None
            else f"Raised {step.label!r} from {declared} to {implied}."
        )

    return corrected, notes


_SLIDES = ("powerpoint", "pptx", "slide deck", "slides")
_SHEET = ("spreadsheet", "xlsx", "excel")
_WORD = ("word document", "word doc", "docx")
_PDF = ("pdf",)
_MARKDOWN = ("markdown", "briefing", "write a note", "save a note", "keep here")


def _work_files_tool(text: str) -> str | None:
    lowered = text.lower()
    if any(w in lowered for w in _SLIDES):
        return "create_slides"
    if any(w in lowered for w in _SHEET):
        return "create_spreadsheet"
    if any(w in lowered for w in _WORD):
        return "create_document"
    if any(w in lowered for w in _PDF):
        return "create_pdf"
    if any(w in lowered for w in _MARKDOWN):
        return "create_markdown"
    return None


def attach_work_files(steps: list[PlanStep], user: str) -> tuple[list[PlanStep], list[str]]:
    """Name work_files on a keepable-file request the model planned as a bare task.

    Yes replays connector + tool from the stored plan. A create_task with no
    call is a ledger row and an empty artifacts rail.
    """
    if any(step.connector == "work_files" for step in steps):
        return steps, []

    tool = _work_files_tool(f"{user} {' '.join(step.label for step in steps)}")
    if tool is None:
        return steps, []

    notes: list[str] = []
    out: list[PlanStep] = []
    filled = False
    for step in steps:
        if filled or step.connector or step.action not in ("", "create_task", "draft"):
            out.append(step)
            continue
        arguments = dict(step.arguments)
        if not arguments.get("title"):
            arguments["title"] = user.strip()[:80] or "Note"
        if tool in ("create_markdown", "create_document", "create_pdf") and not arguments.get("body"):
            arguments["body"] = user.strip()[:4000]
        out.append(
            step.model_copy(
                update={
                    "action": "create_task",
                    "connector": "work_files",
                    "tool": tool,
                    "arguments": arguments,
                }
            )
        )
        notes.append(f"Named work_files.{tool} on {step.label!r} so Yes can save the file.")
        filled = True
    return out, notes
