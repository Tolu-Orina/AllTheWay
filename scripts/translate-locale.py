"""Translate the English catalogue into another language, using Vertex.

    python scripts/translate-locale.py yo

## Why a script and not a translation service

The interface is roughly four hundred strings, because the agent's own output is
already in the user's language — only the chrome needs translating. A TMS earns
its place when people who do not use git need to edit strings; until then it is
a database, a vendor and a second CI for a job one script does with
infrastructure this project already pays for.

## The output is a draft, not a release

Machine translation is a first pass. The file it writes is marked as needing
review, and a native reader should go through it before anyone relies on it.
Shipping unreviewed output as though it were finished is how a product ends up
insulting the people it claims to serve.

## Placeholders and plural suffixes are preserved

`{{name}}` must survive intact or the string breaks at runtime, and `_one` /
`_other` keys must keep their suffixes or plural selection silently stops
working. Both are checked after translation rather than hoped for.
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = ROOT / "web" / "src" / "locales" / "en.json"

MODEL = "gemini-3.7-flash"
PROJECT = "alltheway-rinegan"

LANGUAGES = {
    "yo": "Yorùbá (as spoken in Nigeria)",
    "cy": "Welsh (Cymraeg)",
    "es": "Spanish (Spain)",
    "fr": "French (France)",
    "pt": "Brazilian Portuguese",
    "zh": "Simplified Chinese",
}

PLURAL_SUFFIXES = ("zero", "one", "two", "few", "many", "other")

PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


def flatten(node: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in node.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


def unflatten(flat: dict[str, str]) -> dict:
    out: dict = {}
    for path, value in flat.items():
        node = out
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return out


def plural_categories(code: str) -> list[str]:
    """The plural forms this language actually needs, from ICU.

    Asked of Node's `Intl.PluralRules` rather than kept in a table here, because
    a table is a second copy of CLDR that drifts silently. The runtime selects a
    category with the same data; anything else guarantees a key nothing renders.

    This is not a formality. English has two forms; Welsh has **six**, and
    French, Spanish and Portuguese each have a `many` that English has no
    concept of. A translator working from an English file has no reason to know
    that, and the missing forms fall through to English mid-sentence.
    """
    import subprocess

    script = (
        "const pr = new Intl.PluralRules(process.argv[1]);"
        "const seen = new Set();"
        "for (let n = 0; n <= 200; n++) seen.add(pr.select(n));"
        "for (const n of [0.5, 1.5, 2.5, 1e6]) seen.add(pr.select(n));"
        "console.log([...seen].join(','));"
    )
    out = subprocess.run(
        ["node", "-e", script, code], capture_output=True, text=True, check=True
    )
    found = set(out.stdout.strip().split(","))
    return [c for c in PLURAL_SUFFIXES if c in found]


def expand_plurals(strings: dict[str, str], code: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Replace English plural keys with the ones the target language needs.

    English `decisions_one` / `decisions_other` becomes six keys for Welsh and
    one for Chinese. The English forms are passed as context so the model can
    see both the singular and the plural wording it is working from.
    """
    categories = plural_categories(code)

    stems: dict[str, list[str]] = {}
    for key in strings:
        stem, _, suffix = key.rpartition("_")
        if suffix in PLURAL_SUFFIXES and stem:
            stems.setdefault(stem, []).append(key)

    expanded = {k: v for k, v in strings.items() if k.rpartition("_")[2] not in PLURAL_SUFFIXES}
    for stem, keys in stems.items():
        # Whichever English form exists, as the source text.
        source = strings.get(f"{stem}_other") or strings[keys[0]]
        for category in categories:
            expanded[f"{stem}_{category}"] = source

    return expanded, stems


def translate(strings: dict[str, str], language: str) -> dict[str, str]:
    import google.auth
    import google.auth.transport.requests
    import requests

    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    credentials.refresh(google.auth.transport.requests.Request())

    instruction = (
        f"Translate this software interface into {language}.\n\n"
        "Rules:\n"
        "- Keep every {{placeholder}} exactly as written, including the braces.\n"
        "- Translate naturally, as a native speaker would write an app, not literally.\n"
        "- Keep it short: these are buttons and labels, and a translation twice as "
        "long as the original will not fit the layout it was designed for.\n"
        "- Return ONLY a JSON object with the same keys and translated values.\n\n"
        + json.dumps(strings, ensure_ascii=False, indent=1)
    )

    response = requests.post(
        f"https://aiplatform.googleapis.com/v1/projects/{PROJECT}"
        f"/locations/global/publishers/google/models/{MODEL}:generateContent",
        headers={"Authorization": f"Bearer {credentials.token}"},
        json={
            "contents": [{"role": "user", "parts": [{"text": instruction}]}],
            # Deterministic: rerunning must not churn the file with synonyms.
            "generationConfig": {"temperature": 0, "maxOutputTokens": 8000},
        },
        timeout=180,
    )
    response.raise_for_status()

    text = "".join(
        part.get("text", "")
        for candidate in response.json().get("candidates", [])
        for part in (candidate.get("content") or {}).get("parts", [])
    )
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    return json.loads(text)


def check(english: dict[str, str], translated: dict[str, str]) -> list[str]:
    """What must hold, whatever the model returned."""
    problems: list[str] = []

    missing = sorted(set(english) - set(translated))
    if missing:
        problems.append(f"{len(missing)} keys missing, first: {missing[:3]}")

    for key, source in english.items():
        target = translated.get(key)
        if target is None:
            continue
        want = sorted(PLACEHOLDER.findall(source))
        got = sorted(PLACEHOLDER.findall(target))
        if want != got:
            # A dropped placeholder is a string that renders wrong at runtime and
            # reads fine in review.
            problems.append(f"{key}: placeholders {want} became {got}")

    return problems


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in LANGUAGES:
        print(f"usage: translate-locale.py [{'|'.join(LANGUAGES)}]")
        return 2

    code = sys.argv[1]
    english = flatten(json.load(io.open(EN, encoding="utf-8")))
    expanded, stems = expand_plurals(english, code)

    categories = plural_categories(code)
    print(f"  {LANGUAGES[code]}: {len(expanded)} strings, plural forms {categories}")
    if stems:
        forms = len(stems) * len(categories)
        print(f"  {len(stems)} plural keys -> {forms} forms (English supplies {sum(len(v) for v in stems.values())})")

    translated = translate(expanded, LANGUAGES[code])

    problems = check(expanded, translated)
    if problems:
        print("\nFAILURES:")
        for line in problems:
            print(f"  {line}")
        return 1

    out = ROOT / "web" / "src" / "locales" / f"{code}.json"
    io.open(out, "w", encoding="utf-8", newline="\n").write(
        json.dumps(unflatten(translated), ensure_ascii=False, indent=2) + "\n"
    )
    print(f"  wrote {out.relative_to(ROOT)}")
    print("  NOTE: machine-translated. A native reader should review it before release.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
