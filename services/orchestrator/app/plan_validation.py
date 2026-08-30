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


_PLACEHOLDER_EVENT_IDS = frozenset(
    {
        "",
        "new",
        "pending",
        "none",
        "null",
        "event_id",
        "the new event",
    }
)


def _attendee_emails(arguments: dict) -> list[str]:
    raw = arguments.get("attendees")
    if isinstance(raw, list):
        parts = [str(item).strip() for item in raw]
    elif isinstance(raw, str) and raw.strip():
        parts = [p.strip() for p in raw.replace(";", ",").split(",")]
    else:
        parts = []
    out: list[str] = []
    seen: set[str] = set()
    for email in parts:
        if not email or "@" not in email:
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(email)
    return out


def fold_new_event_invites(steps: list[PlanStep]) -> tuple[list[PlanStep], list[str]]:
    """Invites for a meeting that does not exist yet belong on create_event.

    send_invite needs an event_id. A plan that creates then invites with
    event_id="" cannot replay after Yes — the id only exists once create ran.
    Fold those invites onto create_event.attendees so one confirmed call both
    puts it on the calendar and emails the people they named.
    """
    create_idx: int | None = None
    extras: list[str] = []
    drop: set[int] = set()
    for i, step in enumerate(steps):
        connector = step.connector or ""
        if step.tool == "create_event" and connector in ("google_calendar", "calendar", ""):
            if create_idx is None:
                create_idx = i
            continue
        if step.tool != "send_invite" or create_idx is None:
            continue
        eid = str(step.arguments.get("event_id") or "").strip().lower()
        if eid in _PLACEHOLDER_EVENT_IDS or eid.startswith("<") or "{{" in eid:
            email = str(step.arguments.get("email") or "").strip()
            if email:
                extras.append(email)
                drop.add(i)

    if create_idx is None:
        return steps, []

    create = steps[create_idx]
    merged = _attendee_emails(create.arguments)
    for email in extras:
        if email.lower() not in {e.lower() for e in merged}:
            merged.append(email)

    if not merged and not drop:
        return steps, []

    notes: list[str] = []
    args = dict(create.arguments)
    if merged:
        args["attendees"] = ",".join(merged)
        notes.append(
            "Put invites on create_event so Yes does not need an event id that does not exist yet."
        )
    updated = create.model_copy(
        update={
            "arguments": args,
            "action": str(Action.SEND_EXTERNAL) if merged else create.action,
        }
    )
    out = [updated if i == create_idx else step for i, step in enumerate(steps) if i not in drop]
    return out, notes


#: A later turn that clearly refers to a draft that already exists.
_SEND_THIS_DRAFT = re.compile(
    r"\b(?:send (?:this|that|the) draft)\b",
    re.I,
)

_GMAIL = frozenset({"google_gmail", "gmail", ""})


_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.\w+", re.I)
_TO_NAME = re.compile(
    r"\bto\s+(?!the\b|an?\b|me\b|us\b|this\b|that\b|it\b)([A-Za-z][\w'.-]+)",
    re.I,
)
_ABOUT = re.compile(r"\b(?:about|regarding|re:)\s+(.+)", re.I | re.S)
_MESSAGE_IS = re.compile(
    r"\b(?:the )?(?:message|email|mail|body)\s+(?:is|should be|says|should say)\s+(.+)",
    re.I | re.S,
)
_TRAILING_POLITE = re.compile(r"\s+(please|today|tomorrow)\s*$", re.I)
_WRAPPER_ONLY = re.compile(
    r"^(?:please\s+|i (?:want|would like|'d like) to\s+|can you\s+|could you\s+)*"
    r"(?:send|email|compose|draft)\s+(?:(?:an?\s+)?(?:email|message|mail|draft)\s+)?"
    r"(?:to\s+[A-Za-z][\w'.-]+)?\s*$",
    re.I,
)


def _user_lines(thread: list[str]) -> list[str]:
    out: list[str] = []
    for line in thread:
        lowered = line.lower()
        if lowered.startswith("user:"):
            out.append(line.split(":", 1)[1].strip())
        elif lowered.startswith("agent:") or lowered.startswith("options:"):
            continue
        elif line.strip():
            out.append(line.strip())
    return out


def _corpus(user: str, thread: list[str]) -> str:
    return "\n".join([*(_user_lines(thread)), user.strip()]).strip()


def emails_in(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in _EMAIL.findall(text):
        key = match.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(match)
    return out


def _recipient_name(text: str) -> str:
    matches = _TO_NAME.findall(text)
    return matches[-1] if matches else ""


def _about_clause(text: str) -> str:
    match = _ABOUT.search(text)
    if not match:
        return ""
    return _TRAILING_POLITE.sub("", match.group(1).strip()).strip(" .,")


def body_from_utterance(text: str) -> str:
    """The mail itself, not the 'send this to Blessing' wrapper."""
    trimmed = text.strip()
    if not trimmed or _EMAIL.fullmatch(trimmed):
        return ""
    match = _MESSAGE_IS.search(trimmed)
    if match:
        rest = match.group(1).strip()
        about = _about_clause(rest)
        return about or rest
    about = _about_clause(trimmed)
    if about:
        return about
    if _WRAPPER_ONLY.match(trimmed):
        return ""
    return trimmed


def _as_to(value: object) -> str:
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def fill_gmail_compose(
    steps: list[PlanStep],
    user: str,
    thread: list[str] | None = None,
) -> tuple[list[PlanStep], list[str]]:
    """Put spoken names, addresses, subject, and body onto create_draft.

    The live model often names the tool and leaves to/subject/body empty, so
    the confirm form opens blank even after they have said who and what.
    """
    lines = thread or []
    corpus = _corpus(user, lines)
    found = emails_in(corpus)
    notes: list[str] = []
    out: list[PlanStep] = []
    changed = False
    for step in steps:
        connector = step.connector or ""
        if step.tool != "create_draft" or connector not in _GMAIL:
            out.append(step)
            continue
        args = dict(step.arguments)
        to = _as_to(args.get("to"))
        if found:
            args["to"] = ", ".join(found)
        elif not to:
            name = _recipient_name(corpus)
            if name:
                args["to"] = name

        spoken = body_from_utterance(user)
        if not spoken:
            for line in reversed(_user_lines(lines)):
                spoken = body_from_utterance(line)
                if spoken:
                    break
        if spoken and not str(args.get("body") or "").strip():
            args["body"] = spoken[:4000]

        subject = str(args.get("subject") or "").strip()
        raw = user.strip()[:80]
        if not subject or subject == raw:
            about = _about_clause(user) or _about_clause(corpus)
            body = str(args.get("body") or "").strip()
            if about:
                args["subject"] = about[:80]
            elif body:
                args["subject"] = body.split("\n", 1)[0][:80]
            elif subject == raw:
                args["subject"] = ""

        if args != dict(step.arguments):
            changed = True
        out.append(step.model_copy(update={"arguments": args}))
    if changed:
        notes.append("Filled the Gmail draft from what they said.")
    return out, notes


def prefer_gmail_draft(steps: list[PlanStep], user: str) -> tuple[list[PlanStep], list[str]]:
    """First email turn is always a draft. Sending is a later, explicit turn.

    The live model hears "send an email to Blessing" and names send_email.
    Yes then looks like a send, the compose form never appears, and a missing
    body becomes a ledger row with nothing in Gmail. Rewriting the tool (not
    the person's words) is what makes the first Yes save a draft.
    """
    if _SEND_THIS_DRAFT.search(user):
        return steps, []

    notes: list[str] = []
    out: list[PlanStep] = []
    for step in steps:
        connector = step.connector or ""
        if step.tool == "send_email" and connector in _GMAIL:
            out.append(
                step.model_copy(
                    update={
                        "tool": "create_draft",
                        "action": str(Action.DRAFT),
                        "connector": step.connector or "google_gmail",
                    }
                )
            )
            notes.append(
                "First email turn is a draft. Sending waits until they have seen it."
            )
        else:
            out.append(step)
    return out, notes


def _same_write(step: PlanStep, action: dict) -> bool:
    connector = step.connector or ""
    other = str(action.get("connector") or "")
    tool = str(action.get("tool") or "")
    if step.tool == tool and (not connector or not other or connector == other):
        return True
    if (
        step.tool == "send_email"
        and tool == "create_draft"
        and connector in _GMAIL
        and other in _GMAIL
    ):
        return True
    if step.label == action.get("label") and step.tool and tool:
        return True
    return False


def align_plan_to_confirmation(plan: list[PlanStep], actions: list[dict]) -> list[PlanStep]:
    """Replay the calls the confirm gate showed, not the pre-rewrite stream.

    Steps are yielded as the model produces them. `_finish` then rewrites
    send_email to create_draft. Yes used to replay the streamed step, so the
    first email still sent.
    """
    writes = [a for a in actions if a.get("connector") and a.get("tool")]
    if not writes:
        return plan
    taken: set[int] = set()
    out: list[PlanStep] = []
    for step in plan:
        idx = next(
            (i for i, action in enumerate(writes) if i not in taken and _same_write(step, action)),
            None,
        )
        if idx is None:
            out.append(step)
            continue
        taken.add(idx)
        action = writes[idx]
        args = dict(step.arguments)
        extra = action.get("arguments")
        if isinstance(extra, dict):
            args.update(extra)
        out.append(
            step.model_copy(
                update={
                    "connector": str(action.get("connector") or step.connector),
                    "tool": str(action.get("tool") or step.tool),
                    "action": str(action.get("action") or step.action),
                    "arguments": args,
                }
            )
        )
    return out

