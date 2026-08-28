"""Hat-scope is a filter, never a guess."""

from app.store import applies_hat


def test_an_unlabelled_document_retrieves_under_every_hat():
    assert applies_hat(None, "home") is True
    assert applies_hat("", "work") is True
    assert applies_hat(None, None) is True


def test_all_includes_labelled_documents():
    assert applies_hat("home", None) is True
    assert applies_hat("work", None) is True


def test_a_home_filter_excludes_a_work_document():
    assert applies_hat("work", "home") is False
    assert applies_hat("home", "home") is True


def test_a_filename_is_not_a_hat():
    # There is no hat_for_title. A school policy uploaded without a picker
    # stays unlabeled. This test exists so nobody adds a guesser later
    # without noticing.
    assert not hasattr(__import__("app.store", fromlist=["hat_for_title"]), "hat_for_title")
