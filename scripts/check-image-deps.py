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

## Second check: third-party imports must be declared, not inherited

Connector modules run as subprocesses, so an import they get wrong fails at the
moment a user invokes the tool rather than at startup — later and quieter than
the failures above.

The media connector found the shape of it: it imports `google.auth`, which was
present only because `google-cloud-firestore` happens to depend on it. That
works until the day it does not, and it is the same implicit-dependency bug as
`ws` above, where a package existed only as another package's hoisted
transitive and vanished when that package was pruned.

So every third-party root imported by a service or its connectors must appear
in that service's own dependency list. Inheriting one transitively is exactly
the arrangement that broke before.
"""

from __future__ import annotations

import glob
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


#: Import root -> the distribution that must be declared for it. Explicit
#: rather than inferred: guessing that `google.auth` comes from `google-auth`
#: is right, and guessing that `google.cloud.firestore` comes from
#: `google-cloud` is wrong, so the mapping is written down.
DISTRIBUTIONS = {
    "httpx": "httpx",
    "mcp": "mcp",
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "pydantic": "pydantic",
    "a2a": "a2a-sdk",
    "requests": "requests",
    "jwt": "pyjwt",
    "google.auth": "google-auth",
    "google.cloud.firestore": "google-cloud-firestore",
    "google.cloud.storage": "google-cloud-storage",
    "pypdf": "pypdf",
    "google.genai": "google-genai",
    "google.protobuf": "protobuf",
}

#: Imported from within the service itself, so not a dependency of anything.
LOCAL_ROOTS = {"app", "connectors", "alltheway"}


def _distribution_root(module: str, names: list[str]) -> set[str]:
    """Normalise one import statement to the roots that must be declared.

    `google` is the whole reason this is a function. A single `google` root
    spans google-auth, google-cloud-firestore and protobuf, so collapsing them
    to one name lets a missing dependency hide behind a present one — which is
    exactly the bug this file exists to catch.

    The submodule matters too: `from google.cloud import firestore` names the
    distribution on the right-hand side, not the left.
    """
    parts = module.split(".")
    if parts[0] != "google":
        return {parts[0]}

    if len(parts) >= 2 and parts[1] == "cloud":
        # `google.cloud` is a namespace package, never a distribution. Only the
        # segment straight after it names one; anything deeper is that
        # package's internals, and `firestore_v1` is the generated surface of
        # google-cloud-firestore rather than a package of its own.
        tails = parts[2:3] or names
        return {f"google.cloud.{t.split('_v')[0]}" for t in tails}

    if len(parts) == 1:
        # `from google import genai` — the distribution is named on the right.
        return {f"google.{n}" for n in names}

    return {".".join(parts[:2])}


def third_party_roots(text: str) -> set[str]:
    """Import roots that must come from a package this service declares."""
    roots: set[str] = set()

    pattern = r"^[ \t]*(?:import[ \t]+([\w.]+)|from[ \t]+([\w.]+)[ \t]+import[ \t]+([^\n#]+))"
    for plain, source, names in re.findall(pattern, text, flags=re.MULTILINE):
        module = plain or source
        if module.startswith("."):
            # A relative import is this service's own code.
            continue
        head = module.split(".")[0]
        if (
            head in sys.stdlib_module_names
            or head in LOCAL_ROOTS
            or head.startswith("alltheway")
            or head.startswith("_")
        ):
            continue
        imported = [n.strip() for n in names.replace("(", "").split(",") if n.strip()]
        roots |= _distribution_root(module, imported)

    return roots


def dockerfile_continuations(text: str) -> list[str]:
    """Lines that continue a shell command without anything continuing into them.

    Docker joins a RUN across newlines only where the previous line ends in a
    backslash. A line beginning `&&` or `||` after one that does not is not a
    continuation — it is a new instruction, and Docker reports
    `unknown instruction: &&`.

    This is the second time that broke a build here, and it cannot be caught by
    any amount of reading: `docker build` is the only thing that parses a
    Dockerfile, and there is no daemon on the machine where these are edited.
    Twelve lines of check are cheaper than a deploy cycle to discover it.
    """
    problems: list[str] = []
    previous = ""
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith(("&&", "||")) and not previous.rstrip().endswith(chr(92)):
            problems.append(f"line {number}: {stripped[:60]}")
        previous = line
    return problems


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


    for path in sorted(ROOT.glob("services/*/Dockerfile")):
        broken = dockerfile_continuations(io.open(path, encoding="utf-8").read())
        if broken:
            failures.append(
                f"{path.parent.name}: shell continuation missing before {broken} - "
                "Docker reads this as a new instruction and the build will not parse"
            )
        print(f"  {path.parent.name:20} dockerfile syntax    {'OK' if not broken else 'BROKEN'}")

    print()
    for service in python_services():
        dockerfile = io.open(
            ROOT / "services" / service / "Dockerfile", encoding="utf-8"
        ).read()

        # A library can be COPYed into the build context and still not be built
        # into the wheelhouse the install resolves from. pip then reports
        # "No matching distribution found", which reads like a missing package
        # on PyPI rather than a line missing from this Dockerfile.
        #
        # That is exactly how the orchestrator's screening dependency failed: the
        # COPY was present, this check passed, and the build broke anyway.
        copied = set(re.findall(r"COPY libs/(\w+)", dockerfile))

        # Only what the `pip wheel` invocation names. Scanning the whole file
        # would match each COPY's own destination — `COPY libs/x ./libs/x` — so
        # every copied library would look built and this check could never fail.
        # It did exactly that when first written.
        wheel_lines = [
            line for line in dockerfile.splitlines() if "pip wheel" in line
        ]
        wheeled = set(re.findall(r"\./libs/(\w+)", " ".join(wheel_lines)))

        unbuilt = sorted(copied - wheeled)
        if unbuilt:
            failures.append(
                f"{service}: copies {unbuilt} into the image but never builds "
                "them into the wheelhouse, so the install cannot resolve them"
            )
        print(f"  {service:20} wheelhouse           {'OK' if not unbuilt else 'MISSING'}")

    print()
    for service in python_services():
        directory = ROOT / "services" / service
        sources = glob.glob(str(directory / "app" / "*.py")) + glob.glob(
            str(directory / "connectors" / "*.py")
        )
        text = " ".join(io.open(f, encoding="utf-8").read() for f in sources)
        manifest = io.open(directory / "pyproject.toml", encoding="utf-8").read()

        undeclared: list[str] = []
        unmapped: list[str] = []
        for root in sorted(third_party_roots(text)):
            distribution = DISTRIBUTIONS.get(root)
            if distribution is None:
                unmapped.append(root)
            elif f'"{distribution}' not in manifest:
                undeclared.append(f"{root} (needs {distribution})")

        if undeclared:
            failures.append(
                f"{service}: imports {undeclared} without declaring it - "
                "today it resolves only as another package's transitive"
            )
        if unmapped:
            failures.append(
                f"{service}: imports {unmapped}, which this check has no mapping for. "
                "Add it to DISTRIBUTIONS so it is checked rather than assumed."
            )
        state = "OK" if not (undeclared or unmapped) else "MISSING"
        print(f"  {service:20} third-party imports  {state}")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(f"  {line}")
        return 1

    print("\nevery service carries the libraries it imports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
