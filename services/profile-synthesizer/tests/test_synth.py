from app.synth import classify, synthesise


def test_a_real_change_becomes_a_preference():
    out = synthesise(was="Sidebar nav with 6 items", now="Sidebar nav, 4 items")
    assert out is not None
    assert out.area == "Navigation"
    assert out.evidence == "You changed this once"


def test_repeated_corrections_strengthen_the_evidence():
    out = synthesise(was="Long summary", now="Short summary", prior_corrections=6)
    assert out is not None
    assert "7 times" in out.evidence


def test_a_no_op_teaches_nothing():
    # Recording this would pad the profile with something the user never did.
    assert synthesise(was="Same text", now="Same text") is None
    assert synthesise(was="", now="Something") is None
    assert synthesise(was="Something", now="   ") is None


def test_unknown_subject_falls_back_rather_than_guessing():
    assert classify("the pricing tier for enterprise") == "General"


def test_classification_reads_the_change_not_the_screen():
    assert classify("collapse the sidebar navigation") == "Navigation"
    assert classify("shorten the summary wording") == "Writing"
