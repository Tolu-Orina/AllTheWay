"""Autonomy policy.

This is the load-bearing safety rule of the whole product, so it lives in one
pure function with no I/O: it can be read, reasoned about, and exhaustively
tested without a database, a queue, or a model.

Manifest FR-W4: a user sets a per-category ceiling, but irreversible and
high-stakes actions always require review regardless of that ceiling, and that
floor is NOT user-overridable. Only an org admin may waive it, with an
auditable justification — represented here by an explicit waiver argument that
carries who granted it and why.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Ceiling(StrEnum):
    DRAFT_ONLY = "draft_only"
    SEND_AFTER_REVIEW = "send_after_review"
    SEND_AUTOMATICALLY = "send_automatically"


class Action(StrEnum):
    """What a watcher run wants to do at the end of its plan."""

    DRAFT = "draft"                      # produce something, touch nothing
    CREATE_TASK = "create_task"          # internal, reversible
    UPDATE_RECORD = "update_record"      # internal, reversible
    SEND_EXTERNAL = "send_external"      # leaves the account
    MAKE_PAYMENT = "make_payment"        # moves money
    DELETE_DATA = "delete_data"          # destroys state


#: Actions whose consequences cannot be taken back. The floor applies to these
#: no matter what ceiling the user chose.
IRREVERSIBLE: frozenset[Action] = frozenset(
    {Action.SEND_EXTERNAL, Action.MAKE_PAYMENT, Action.DELETE_DATA}
)


@dataclass(frozen=True)
class Waiver:
    """An org admin's auditable waiver of the irreversible-action floor."""

    granted_by: str
    justification: str

    def is_valid(self) -> bool:
        # A waiver with no attributable admin or no stated reason is not a
        # waiver; it is a missing check wearing a waiver's name.
        return bool(self.granted_by.strip()) and len(self.justification.strip()) >= 10


@dataclass(frozen=True)
class Decision:
    execute: bool
    reason: str


def decide(
    action: Action,
    ceiling: Ceiling,
    *,
    waiver: Waiver | None = None,
) -> Decision:
    """Whether a watcher may carry out `action` unsupervised."""

    if action in IRREVERSIBLE:
        if waiver is not None and waiver.is_valid():
            return Decision(
                execute=ceiling is Ceiling.SEND_AUTOMATICALLY,
                reason=(
                    f"Irreversible action waived by {waiver.granted_by}: "
                    f"{waiver.justification}"
                )
                if ceiling is Ceiling.SEND_AUTOMATICALLY
                else "Waiver present, but the ceiling still requires review.",
            )
        return Decision(
            execute=False,
            reason="Irreversible actions always stop for review. This floor is not user-adjustable.",
        )

    if ceiling is Ceiling.DRAFT_ONLY:
        return Decision(execute=False, reason="Ceiling is draft only.")

    if ceiling is Ceiling.SEND_AFTER_REVIEW:
        return Decision(execute=False, reason="Ceiling requires your review first.")

    return Decision(execute=True, reason="Reversible action within the ceiling you set.")
