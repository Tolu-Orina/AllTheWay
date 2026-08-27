#!/usr/bin/env python3
"""Prove every test file is actually run.

Each service names its test files by hand in `package.json`:

    "test": "node --import tsx --test src/voice.test.ts src/artifacts.test.ts ..."

That is deliberate. Node's directory discovery finds one file here rather than
seven, and an unquoted `src/**/*.test.ts` is expanded by the shell before node
sees it -- without `globstar` that becomes `src/*/*.test.ts`, which matches
nothing at all. Both alternatives fail the same way: the suite passes, quickly,
having run almost nothing.

So the list stays explicit, and this guard covers its one weakness: writing a
new test file and forgetting to add it. Without this, that test never runs and
nothing says so -- the most expensive kind of green build, because it is
indistinguishable from a real one.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    problems: list[str] = []
    checked = 0

    for pkg in sorted(ROOT.glob("services/*/package.json")):
        service = pkg.parent
        script = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {}).get("test")
        if not script:
            continue

        listed = set(re.findall(r"src/[\w./-]+\.test\.ts", script))
        actual = {
            str(p.relative_to(service)).replace("\\", "/")
            for p in service.glob("src/**/*.test.ts")
        }
        checked += len(actual)

        for missing in sorted(actual - listed):
            problems.append(
                f"{service.name}: {missing} exists but is not in the test script, so it never runs"
            )
        for gone in sorted(listed - actual):
            problems.append(
                f"{service.name}: the test script names {gone}, which does not exist"
            )

    if problems:
        print("Test files that are not run:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\nAdd the file to the `test` script in that service's package.json.",
            file=sys.stderr,
        )
        return 1

    print(f"check-tests-listed: {checked} test files, all listed and all present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
