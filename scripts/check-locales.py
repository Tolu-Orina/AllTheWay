"""Every language the interface offers must be complete.

A language listed as available and half-translated is worse than one absent: the
user switches, sees English fragments, and learns the feature is unreliable.
They do not switch back and try again later.

    python scripts/check-locales.py

Exits non-zero when a locale is missing a key English has, when a placeholder
was dropped in translation, or when a plural form is incomplete.

## Why placeholders are checked

`{{count}}` that survives review but not translation produces a string that
renders wrong at runtime and reads perfectly in a diff. It is the single most
likely defect in a machine-translated catalogue, and the cheapest to catch.

## Why plural completeness is checked separately

`Intl.PluralRules` picks a category, and a catalogue missing that category falls
through to English mid-sentence. English needs two forms; other languages need
more, and a translator working from an English file has no reason to know that.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "web" / "src" / "locales"
SOURCE = "en"

PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")

def plural_categories(code: str) -> set[str]:
    """The plural forms this language needs, asked of ICU.

    Derived rather than tabulated. A table here would be a second copy of CLDR
    that drifts from the one the browser uses at runtime — and the failure is a
    key nobody renders, in a language nobody on the team reads.

    English has two forms. Welsh has six. French, Spanish and Portuguese each
    have a `many` English has no concept of.
    """
    import subprocess

    script = (
        "const pr = new Intl.PluralRules(process.argv[1]);"
        "const seen = new Set();"
        "for (let n = 0; n <= 200; n++) seen.add(pr.select(n));"
        "for (const n of [0.5, 1.5, 2.5, 1e6]) seen.add(pr.select(n));"
        "console.log([...seen].join(','));"
    )
    try:
        out = subprocess.run(
            ["node", "-e", script, code], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        # Loud rather than lenient: without ICU this check cannot do its job,
        # and passing would claim a guarantee it did not verify.
        raise SystemExit(f"could not ask ICU for {code}'s plural forms; is node on PATH?")

    return set(out.stdout.strip().split(","))


def flatten(node: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in node.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


def plural_stems(keys: set[str]) -> set[str]:
    return {k.rsplit("_", 1)[0] for k in keys if k.rsplit("_", 1)[-1] in
            {"zero", "one", "two", "few", "many", "other"}}


def main() -> int:
    english = flatten(json.load(io.open(LOCALES / f"{SOURCE}.json", encoding="utf-8")))
    stems = plural_stems(set(english))
    # A plural key is satisfied by its forms, not by its stem.
    required = {k for k in english if k.rsplit("_", 1)[0] not in stems}

    failures: list[str] = []

    for path in sorted(LOCALES.glob("*.json")):
        code = path.stem
        if code == SOURCE:
            continue

        catalogue = flatten(json.load(io.open(path, encoding="utf-8")))

        missing = sorted(required - set(catalogue))
        if missing:
            failures.append(
                f"{code}: missing {len(missing)} keys, first: {missing[:3]}"
            )

        categories = plural_categories(code)
        for stem in sorted(stems):
            absent = sorted(f"{stem}_{c}" for c in categories if f"{stem}_{c}" not in catalogue)
            if absent:
                failures.append(f"{code}: incomplete plural {stem} - missing {absent}")

        # Placeholders a plural stem may legitimately use, across all of
        # English's forms for it.
        #
        # A plural form is not compared against the English key of the same
        # name, because there may not be one — Welsh `_few` has no English
        # counterpart — and because English's `_one` says "One thing" while
        # every other language says "1 chose". A target form gaining {{count}}
        # is correct; inventing a placeholder nothing supplies is not.
        stem_placeholders: dict[str, set[str]] = {}
        for key, source in english.items():
            stem = key.rsplit("_", 1)[0]
            if stem in stems:
                stem_placeholders.setdefault(stem, set()).update(PLACEHOLDER.findall(source))

        for key, target in catalogue.items():
            stem = key.rsplit("_", 1)[0]
            got = set(PLACEHOLDER.findall(target))

            if stem in stems:
                allowed = stem_placeholders.get(stem, set())
                invented = sorted(got - allowed)
                if invented:
                    failures.append(f"{code}.{key}: invented placeholders {invented}")
                continue

            source = english.get(key)
            if source is None:
                continue
            expected = set(PLACEHOLDER.findall(source))
            if got != expected:
                failures.append(
                    f"{code}.{key}: placeholders {sorted(expected)} became {sorted(got)}"
                )

        # A form English does not have is correct, not extra: Welsh needs
        # `_few`, and requiring English to carry it would be nonsense.
        english_plus_forms = set(english) | {
            f"{stem}_{c}" for stem in stems for c in categories
        }
        extra = sorted(set(catalogue) - english_plus_forms)
        if extra:
            # It means a key was renamed in English and the translation now
            # carries a string nothing renders.
            failures.append(f"{code}: {len(extra)} keys English no longer has: {extra[:3]}")

        state = "OK" if not any(f.startswith(f"{code}:") or f.startswith(f"{code}.") for f in failures) else "INCOMPLETE"
        print(f"  {code:6} {len(catalogue):3} strings  {state}")

    if failures:
        print("\nFAILURES:")
        for line in failures:
            print(f"  {line}")
        return 1

    print(f"\nevery offered language is complete against {SOURCE} ({len(english)} strings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
