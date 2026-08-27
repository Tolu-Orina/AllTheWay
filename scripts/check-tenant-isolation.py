"""Cross-user retrieval must be impossible, not merely absent.

One user reading another user's contracts, meeting transcripts or photographs
has no degraded state. Every other control in this codebase fails safe — a
broken screener blocks, an unlabelled action asks for confirmation, an
unreadable subscription resolves to Free. This one just breaks.

So it is defended structurally (the owner is in the collection *path*, exactly
as `preferences(uid)` and `sessions(uid)` already are), and this script guards
the two ways that structure could be undone by a future edit:

  1. A `collectionGroup` query. It is the only Firestore construct that spans
     users, so a scoped path stops protecting anything the moment one appears.
     There are none in the codebase today; this keeps it true.

  2. A user-owned collection addressed at the root instead of under its user.
     `db.collection("documentChunks")` reintroduces the flat shape whose only
     defence is a filter someone has to remember.

Neither is catchable by a typechecker, and both would pass every test that does
not specifically look for them — which is the same category as the three image
dependency failures that `check-image-deps.py` now guards.

    python scripts/check-tenant-isolation.py

Exits non-zero on a violation.
"""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Collections that belong to exactly one user and must always be addressed
#: under that user's path.
USER_OWNED = (
    "documents",
    "documentChunks",
    "artifacts",
    "sessions",
    "preferences",
    "watchers",
    "runs",
    "ledger",
    # Added in v3 Phase C. A palette is as much a fingerprint of a company's
    # work as a document is, and gets the same rule rather than a weaker one
    # because it happens to be small.
    "visualPreferences",
    # Added in v3 Phase D. A meeting is the room, verbatim — among the most
    # sensitive things this product holds. `notes` and `commitments` are
    # subcollections of it, and are listed because a root-level `notes`
    # collection would be the same leak wearing a different name.
    "meetings",
    "notes",
    "commitments",
    "meetingOptOuts",
    # Added in v3 Phase G. Session health is joined to a meeting, and a meeting
    # is joined to a person — a root-level `health` collection would say who was
    # in a call and when their connection dropped.
    "health",
    # Added in v3 Phase E. A share is a property of the artifact and lives under
    # it; the grantee's index lives under the grantee. Neither belongs at the
    # root, where it would enumerate who can see whose work.
    "shares",
    "sharedWithMe",
    "recoveries",
    "pushTokens",
)

#: Spans every user by definition. Permitted nowhere.
COLLECTION_GROUP = re.compile(r"\bcollection_?[Gg]roup\s*\(")

#: A user-owned collection addressed on the ROOT client, e.g.
#: `db.collection("documentChunks")`. What makes it a violation is the
#: receiver, not the name: `user_doc(uid).collection("watchers")` is correct
#: and common, and an earlier version of this check wrongly flagged it.
#: The receiver may itself be a call. The scribe writes `db().collection(...)`
#: because its client is lazily constructed, and an earlier version of this
#: pattern required a bare name — so it matched nothing in that service at all
#: and reported it clean. A guard that silently covers fewer files than it
#: claims is worse than no guard, because it is trusted.
ROOT_COLLECTION = re.compile(
    r"""(?:db|client|firestore)\s*(?:\(\s*\))?\s*\.\s*collection\(\s*["']({})["']\s*\)""".format(
        "|".join(USER_OWNED)
    )
)

SEARCH = ("services", "libs")
SUFFIXES = (".py", ".ts")

#: This file names the very patterns it forbids.
EXEMPT = {"scripts/check-tenant-isolation.py"}


def sources() -> list[Path]:
    found: list[Path] = []
    for area in SEARCH:
        for suffix in SUFFIXES:
            found.extend(
                p
                for p in (ROOT / area).rglob(f"*{suffix}")
                if "node_modules" not in p.parts and "__pycache__" not in p.parts
            )
    return sorted(found)


def main() -> int:
    violations: list[str] = []
    scanned = 0

    for path in sources():
        rel = path.relative_to(ROOT).as_posix()
        if rel in EXEMPT:
            continue
        scanned += 1
        text = io.open(path, encoding="utf-8", errors="replace").read()

        for number, line in enumerate(text.splitlines(), start=1):
            # A comment explaining why something is forbidden is not a use of it.
            stripped = line.strip()
            if stripped.startswith(("#", "//", "*")):
                continue

            if COLLECTION_GROUP.search(line):
                violations.append(
                    f"{rel}:{number}  collectionGroup spans every user — "
                    f"scoped paths stop protecting anything"
                )

            match = ROOT_COLLECTION.search(line)
            if match:
                violations.append(
                    f"{rel}:{number}  root-level collection({match.group(1)!r}) — "
                    f"user-owned data must live under users/{{uid}}/"
                )

    print(f"  scanned {scanned} source files")

    if violations:
        print("\n  TENANT ISOLATION VIOLATIONS:\n")
        for line in violations:
            print(f"    {line}")
        print(
            "\n  User-owned collections are addressed under their user's path, the way\n"
            "  preferences(uid) and sessions(uid) already are. See the v3 plan, §1.4.\n"
        )
        return 1

    print("  no collection-group queries; no user-owned collection at the root")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
