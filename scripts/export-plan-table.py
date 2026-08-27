"""Write the plan table the landing page imports.

`libs/metering` is the authority. The marketing page must not have its own
numbers — a hand-edited table is how $18 and a free trial survived after the
price was locked in pence and trials were never configured.

    python scripts/export-plan-table.py

`scripts/check-plan-table.py` fails the build when the written file drifts.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "libs" / "metering" / "src"))

from alltheway_metering import as_json  # noqa: E402

OUT = ROOT / "web" / "src" / "lib" / "plans.json"


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(as_json(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
