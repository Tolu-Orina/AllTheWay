"""Per-org policy: the ceiling an organisation will allow, and who may waive it.

A `Grant` says what one user allowed one connector to do. That is the user's
own decision, and it is not the only one that matters — an organisation needs
to be able to say "nobody here runs at send_automatically", and have that hold
regardless of what any individual ticks.

## An org policy can only lower, never raise

The effective ceiling is the *lower* of what the user granted and what the org
permits. That direction is the whole point: an org policy that could raise a
ceiling would let an administrator hand an agent more autonomy than the person
it acts for ever agreed to, which inverts consent rather than governing it.

So the two are not alternatives to choose between. They compose, and they
compose in one direction.

## A waiver is an exception with a name on it

FR-W4 allows the irreversible-action floor to be waived, with an auditable
justification. Two things make that safe rather than decorative:

  - the org must permit waivers at all, and may name who can grant one
  - every use is written to an audit trail before the call proceeds

The write happens *first*. A waiver recorded after a successful call is a
record of the calls that worked, which is exactly the set you do not need.

## Absent policy is the strictest policy, not the loosest

An org with no document does not get unrestricted access. It gets the default,
which permits no waivers. A missing row is the most likely state during any
outage or misconfiguration, and it must not be the permissive one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Protocol

from alltheway_policy import Ceiling, Waiver

#: Lowest to highest. Comparing two ceilings needs an order, and StrEnum has
#: none that means anything.
_RANK: dict[Ceiling, int] = {
    Ceiling.DRAFT_ONLY: 1,
    Ceiling.SEND_AFTER_REVIEW: 2,
    Ceiling.SEND_AUTOMATICALLY: 3,
}


@dataclass(frozen=True)
class OrgPolicy:
    """What an organisation permits. Defaults are the strict end."""

    org: str = ""
    #: The highest ceiling anyone in this org may run at.
    max_ceiling: Ceiling = Ceiling.SEND_AUTOMATICALLY
    #: Whether the irreversible-action floor may be waived at all.
    allow_waivers: bool = False
    #: Who may grant one. Empty means "anyone the org trusts to be named",
    #: which is still narrower than nobody being named — `Waiver.is_valid`
    #: already requires an attributable grantor and a real justification.
    waiver_grantors: frozenset[str] = field(default_factory=frozenset)

    def effective_ceiling(self, requested: Ceiling) -> Ceiling:
        """The lower of what the user granted and what the org permits."""
        return requested if _RANK[requested] <= _RANK[self.max_ceiling] else self.max_ceiling

    def permits(self, waiver: Waiver | None) -> tuple[bool, str]:
        """Whether this waiver may be used here, and why not when it may not."""
        if waiver is None:
            return True, ""
        if not self.allow_waivers:
            return False, "This organisation does not permit waiving the autonomy floor."
        if not waiver.is_valid():
            # Restating the library's rule at the org boundary, because the
            # message a user sees should say what is missing.
            return False, "A waiver needs a named grantor and a stated reason."
        if self.waiver_grantors and waiver.granted_by not in self.waiver_grantors:
            return False, f"{waiver.granted_by} may not grant waivers in this organisation."
        return True, ""


DEFAULT = OrgPolicy()


class PolicyStore(Protocol):
    def policy(self, org: str) -> OrgPolicy | None: ...


@dataclass(frozen=True)
class InMemoryPolicies:
    """Tests and local runs. Never a fallback for an unreachable real store."""

    policies: dict[str, OrgPolicy]

    def policy(self, org: str) -> OrgPolicy | None:
        return self.policies.get(org)


class FirestorePolicies:
    COLLECTION = "orgPolicies"

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore

        self._db = firestore.Client(
            project=project or os.environ.get("GOOGLE_CLOUD_PROJECT")
        )

    def policy(self, org: str) -> OrgPolicy | None:
        doc = self._db.collection(self.COLLECTION).document(org).get()
        if not doc.exists:
            return None

        raw_ceiling = doc.get("maxCeiling")
        try:
            max_ceiling = Ceiling(raw_ceiling) if raw_ceiling else DEFAULT.max_ceiling
        except ValueError:
            # An unrecognised ceiling is not guessed at. Falling back to the
            # strictest is the only safe reading of a value we cannot parse.
            max_ceiling = Ceiling.DRAFT_ONLY

        grantors = doc.get("waiverGrantors")
        return OrgPolicy(
            org=org,
            max_ceiling=max_ceiling,
            allow_waivers=bool(doc.get("allowWaivers")),
            waiver_grantors=frozenset(grantors if isinstance(grantors, list) else []),
        )


def resolve(org: str, store: PolicyStore | None) -> OrgPolicy:
    """The org's policy, or the strict default.

    A store that raises is treated as an absent policy rather than allowed to
    propagate: enforcement continues under the default, which is stricter than
    whatever the org configured. The alternative — failing the call — would let
    a Firestore blip stop every connector in the product.
    """
    if store is None:
        return DEFAULT
    try:
        return store.policy(org) or DEFAULT
    except Exception:  # noqa: BLE001 — an unreadable policy is not a permissive one
        return DEFAULT
