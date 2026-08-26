"""Every shared library a service imports must be copied into its image.

This bug class has bitten three times, each time the same way: the code is
correct, the tests pass, the build is green, and the container exits before it
listens because an import that resolves on a developer machine does not resolve
in the image.

  1. `ws` nested under services/gateway/node_modules and never copied
  2. `libs/screening` changed but no trigger watched it, so the image kept the
     old copy while Terraform pointed it at a real Model Armor template
  3. `libs/agentcards` and later `libs/metering` imported but not COPYed

None of it is catchable by typecheck, and only the third is catchable by
reading the diff. So it is checked here instead.

    python scripts/check-image-deps.py

Exits non-zero if a service imports a shared library its Dockerfile does not
carry. Cheap enough to run in CI, and worth it: the failure it prevents costs a
deploy cycle to discover.
"""

from __future__ import annotations

import glob
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def python_services() -> list[str]:
    return sorted(
        p.parent.name
        for p in ROOT.glob("services/*/Dockerfile")
        if (p.parent / "app").is_dir()
    )


def main() -> int:
    failures: list[str] = []

    for service in python_services():
        sources = glob.glob(str(ROOT / "services" / service / "app" / "*.py"))
        text = " ".join(io.open(f, encoding="utf-8").read() for f in sources)

        # `alltheway_screening` on an import line means the image needs
        # libs/screening. The underscore/hyphen swap is the only translation.
        imported = {m.replace("_", "-") for m in re.findall(r"alltheway_(\w+)", text)}
        dockerfile = io.open(
            ROOT / "services" / service / "Dockerfile", encoding="utf-8"
        ).read()

        missing = sorted(lib for lib in imported if f"libs/{lib}" not in dockerfile)
        if missing:
            failures.append(f"{service}: imports {missing} but the image does not COPY them")
        print(f"  {service:20} {sorted(imported) or '-'}  {'OK' if not missing else 'MISSING'}")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(f"  {line}")
        return 1

    print("\nevery service carries the libraries it imports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
