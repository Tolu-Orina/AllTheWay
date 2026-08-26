"""The plan table exists twice. This proves the two copies still agree.

`libs/metering` is the enforcement point: it decides whether a call is allowed.
`services/gateway/src/repos/usage.ts` is what the user is *shown*. They are in
different languages and cannot import each other, so the TypeScript copy carried
a comment saying "changed together, or the UI lies".

It lied. Phase C added a Max tier and three media meters to the Python side
only, and for a while a Max subscriber read as Free on their own usage page —
correct enforcement, wrong story. Nothing failed, nothing logged, and a comment
was the only thing standing between the two.

    python scripts/check-plan-table.py

Exits non-zero when they disagree. The direction that matters is not "the UI
shows the wrong number" but "the UI and the enforcement point tell the user
different things about what they bought".
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "libs" / "metering" / "src"))

from alltheway_metering import as_json  # noqa: E402

USAGE_TS = ROOT / "services" / "gateway" / "src" / "repos" / "usage.ts"


def typescript_table(source: str) -> dict[str, dict]:
    """Read the PLANS literal without executing anything.

    Deliberately a parser rather than a regex per field: a missing tier is the
    failure this exists to catch, and a per-field regex would simply find
    nothing and report agreement.
    """
    start = source.index("const PLANS")
    body = source[start : source.index("\n};", start)]

    plans: dict[str, dict] = {}
    for tier_match in re.finditer(r"^  (\w+): \{$", body, flags=re.MULTILINE):
        tier = tier_match.group(1)
        chunk = body[tier_match.end() : ]
        chunk = chunk[: chunk.index("\n  },")]

        price = re.search(r"pricePence: (\d+)", chunk)
        limits: dict[str, int | None] = {}
        for name, value in re.findall(r"^      (\w+): (null|\d+),$", chunk, flags=re.MULTILINE):
            limits[name] = None if value == "null" else int(value)

        plans[tier] = {
            "pricePence": int(price.group(1)) if price else -1,
            "limits": limits,
        }
    return plans


def main() -> int:
    python_plans = {p["tier"]: p for p in as_json()["plans"]}
    ts_plans = typescript_table(io.open(USAGE_TS, encoding="utf-8").read())

    failures: list[str] = []

    missing = sorted(set(python_plans) - set(ts_plans))
    if missing:
        failures.append(f"the interface has no plan for {missing}; those users would see Free")

    extra = sorted(set(ts_plans) - set(python_plans))
    if extra:
        failures.append(f"the interface offers {extra}, which nothing enforces")

    for tier in sorted(set(python_plans) & set(ts_plans)):
        want, got = python_plans[tier], ts_plans[tier]
        if want["pricePence"] != got["pricePence"]:
            failures.append(
                f"{tier}: priced {got['pricePence']} in the interface, "
                f"{want['pricePence']} where it is charged"
            )
        for meter, limit in want["limits"].items():
            if meter not in got["limits"]:
                failures.append(f"{tier}: the interface never shows {meter}")
            elif got["limits"][meter] != limit:
                failures.append(
                    f"{tier}.{meter}: interface says {got['limits'][meter]}, "
                    f"enforcement says {limit}"
                )

        print(f"  {tier:6} {len(got['limits'])} meters  {'OK' if not failures else ''}")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(f"  {line}")
        return 1

    print("\nthe plan table the user sees is the plan table that is enforced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
