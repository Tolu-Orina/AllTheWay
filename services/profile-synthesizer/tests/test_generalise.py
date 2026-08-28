from app.generalise import ACTIVATION, generalise
from app.memory_bank import propose_from_bank, text_ok
from app.synth import Standing


def test_one_correction_does_not_invent_a_pattern():
    rows = [
        Standing(
            id="s1",
            key="k1",
            area="Writing",
            was="a long summary of the meeting notes",
            now="short note",
        )
    ]
    assert generalise(standing=rows) == []


def test_two_shortening_keys_propose_and_do_not_auto_activate():
    rows = [
        Standing(
            id="s1",
            key="k1",
            area="Writing",
            was="a long summary of the meeting notes",
            now="short note",
        ),
        Standing(
            id="s2",
            key="k2",
            area="Writing",
            was="verbose draft wording in this sentence",
            now="tight copy",
        ),
    ]
    out = generalise(standing=rows)
    assert len(out) == 1
    assert out[0].now == "you consistently shorten writing"
    assert out[0].proposed is True
    assert out[0].confidence < ACTIVATION
    assert out[0].key.startswith("synth:")
    assert not out[0].key.startswith("session")


def test_three_shortening_keys_cross_the_activation_bar():
    rows = [
        Standing(
            id=f"s{i}",
            key=f"k{i}",
            area="Writing",
            was="a long summary of the meeting notes here",
            now="short note",
        )
        for i in range(3)
    ]
    out = generalise(standing=rows)
    assert len(out) == 1
    assert out[0].confidence >= ACTIVATION
    assert out[0].proposed is False


def test_an_existing_synth_row_is_not_duplicated():
    rows = [
        Standing(
            id="s1",
            key="k1",
            area="Writing",
            was="a long summary of the meeting notes",
            now="short note",
        ),
        Standing(
            id="s2",
            key="k2",
            area="Writing",
            was="verbose draft wording in this sentence",
            now="tight copy",
        ),
        Standing(
            id="synth-1",
            key="synth:writing:any:shorten",
            area="Writing",
            was="x",
            now="y",
            source="synth",
        ),
    ]
    assert generalise(standing=rows) == []


def test_work_shortening_does_not_generalise_home():
    rows = [
        Standing(
            id="s1",
            key="k1",
            area="Writing",
            was="a long summary of the meeting notes",
            now="short note",
            hat="work",
        ),
        Standing(
            id="s2",
            key="k2",
            area="Writing",
            was="verbose draft wording in this sentence",
            now="tight copy",
            hat="home",
        ),
    ]
    assert generalise(standing=rows) == []


def test_each_hat_can_earn_its_own_proposal():
    rows = [
        Standing(
            id="w1",
            key="kw1",
            area="Writing",
            was="a long summary of the meeting notes",
            now="short note",
            hat="work",
        ),
        Standing(
            id="w2",
            key="kw2",
            area="Writing",
            was="verbose draft wording in this sentence",
            now="tight copy",
            hat="work",
        ),
        Standing(
            id="h1",
            key="kh1",
            area="Writing",
            was="a long summary of the meeting notes",
            now="short note",
            hat="home",
        ),
        Standing(
            id="h2",
            key="kh2",
            area="Writing",
            was="verbose draft wording in this sentence",
            now="tight copy",
            hat="home",
        ),
    ]
    out = generalise(standing=rows)
    hats = {row.hat for row in out}
    assert hats == {"work", "home"}
    assert all(row.key.startswith("synth:") for row in out)


def test_memory_bank_is_silent_when_unconfigured(monkeypatch):
    monkeypatch.delenv("MEMORY_BANK_RESOURCE", raising=False)
    assert propose_from_bank("u1") == []


def test_bank_facts_that_look_like_personal_info_are_dropped():
    assert text_ok("prefers short summaries") is True
    assert text_ok("school run at 8") is False
    assert text_ok("daughter pickup at three") is False


def test_retrieve_preferences_is_a_real_function():
    from app.memory_bank import _retrieve_preferences

    assert callable(_retrieve_preferences)
