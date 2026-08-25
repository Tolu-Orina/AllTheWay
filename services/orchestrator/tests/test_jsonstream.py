"""The incremental JSON reader.

The invariant under test is the one the UI depends on: **every value this yields
is final**. A prefix may know less than the finished document, but it must never
know something *different* — otherwise a plan step would appear and then change,
and a user watching a plan build would stop trusting what they read.
"""

import json

from app.jsonstream import parse_partial, repair

FULL = '{"decision":"plan","steps":["Scope the work","Draft it"],"note":"hi","n":12}'


def _is_prefix_of(part: dict, whole: dict) -> bool:
    """`part` knows a subset of `whole`, and contradicts none of it."""
    for key, value in part.items():
        if key not in whole:
            return False
        if isinstance(value, list):
            if whole[key][: len(value)] != value:
                return False
        elif whole[key] != value:
            return False
    return True


def test_every_prefix_parses_and_never_contradicts_the_final_document():
    final = json.loads(FULL)
    for i in range(len(FULL) + 1):
        got = parse_partial(FULL[:i])
        assert isinstance(got, dict), i
        assert _is_prefix_of(got, final), (i, FULL[:i], got)


def test_the_whole_document_round_trips():
    assert parse_partial(FULL) == json.loads(FULL)


def test_a_half_arrived_string_is_dropped_not_shown():
    # The killer case: showing "Scope the wo" and replacing it a moment later
    # is worse than showing nothing.
    assert parse_partial('{"decision":"plan","steps":["Scope the wo') == {
        "decision": "plan",
        "steps": [],
    }


def test_completed_strings_survive_an_open_array():
    assert parse_partial('{"decision":"plan","steps":["Scope","Draft"') == {
        "decision": "plan",
        "steps": ["Scope", "Draft"],
    }


def test_a_key_is_not_a_value():
    # `{"a"` must not close to `{"a"}`, which is not valid JSON.
    assert parse_partial('{"decision":"plan","steps"') == {"decision": "plan"}


def test_a_trailing_number_is_withheld_because_it_may_still_grow():
    # 12 could become 123. Emitting it would break the finality invariant.
    assert parse_partial('{"a":1,"b":12') == {"a": 1}


def test_a_trailing_literal_is_withheld():
    assert parse_partial('{"a":1,"b":tru') == {"a": 1}


def test_escaped_quotes_do_not_end_a_string_early():
    assert parse_partial('{"a":"say \\"hi\\" ok"') == {"a": 'say "hi" ok'}


def test_a_trailing_backslash_does_not_break_the_scan():
    assert parse_partial('{"a":1,"b":"x\\') == {"a": 1}


def test_nested_containers_are_closed_in_the_right_order():
    # The trailing 2 is withheld — it could still become 25 — but the closers
    # must still be emitted innermost-first.
    assert parse_partial('{"a":{"b":[1,2') == {"a": {"b": [1]}}
    assert repair('{"a":{"b":[1,2').endswith("]}}")
    assert parse_partial('{"a":{"b":[1,2],') == {"a": {"b": [1, 2]}}


def test_markdown_fences_are_tolerated():
    assert parse_partial('```json\n{"decision":"clarify"') == {"decision": "clarify"}


def test_nothing_usable_yields_an_empty_object_rather_than_raising():
    for text in ("", "   ", "not json at all", "[1,2,3]"):
        assert parse_partial(text) == {}


def test_empty_containers_are_valid():
    assert parse_partial('{"steps":[]}') == {"steps": []}
    assert parse_partial('{"steps":[') == {"steps": []}
