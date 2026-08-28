from app.synth import Standing, classify, key_for, plan_commit, synthesise


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


def test_a_continuation_reuses_the_key_and_revokes_the_old_row():
    first = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[],
        own_id="session-1",
    )
    assert first is not None
    second = plan_commit(
        was="Sidebar nav, 4 items",
        now="Sidebar nav, 3 items",
        standing=[
            Standing(
                id="session-1",
                key=first.key,
                area=first.learned.area,
                was=first.learned.was,
                now=first.learned.now,
            )
        ],
        own_id="session-2",
    )
    assert second is not None
    assert second.key == first.key
    assert second.revoke_ids == ("session-1",)
    assert "2 times" in second.learned.evidence


def test_a_reversal_of_the_same_fact_does_not_leave_two_opposites():
    first = plan_commit(
        was="Long summary",
        now="Short summary",
        standing=[],
        own_id="session-1",
    )
    assert first is not None
    reversed_ = plan_commit(
        was="Short summary",
        now="Long summary",
        standing=[
            Standing(
                id="session-1",
                key=first.key,
                area=first.learned.area,
                was=first.learned.was,
                now=first.learned.now,
            )
        ],
        own_id="session-2",
    )
    assert reversed_ is not None
    assert reversed_.key == first.key
    assert reversed_.revoke_ids == ("session-1",)


def test_independent_facts_in_the_same_area_keep_distinct_keys():
    nav = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[],
        own_id="session-1",
    )
    assert nav is not None
    collapse = plan_commit(
        was="A wide persistent sidebar",
        now="Collapse the sidebar by default",
        standing=[
            Standing(
                id="session-1",
                key=nav.key,
                area=nav.learned.area,
                was=nav.learned.was,
                now=nav.learned.now,
            )
        ],
        own_id="session-2",
    )
    assert collapse is not None
    assert nav.key != collapse.key
    assert collapse.revoke_ids == ()
    assert collapse.learned.evidence == "You changed this once"


def test_a_writing_correction_does_not_inflate_navigation_evidence():
    nav = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[],
        own_id="session-1",
    )
    assert nav is not None
    writing = plan_commit(
        was="Long summary",
        now="Short summary",
        standing=[
            Standing(
                id="session-1",
                key=nav.key,
                area=nav.learned.area,
                was=nav.learned.was,
                now=nav.learned.now,
            )
        ],
        own_id="session-2",
    )
    assert writing is not None
    assert writing.learned.evidence == "You changed this once"
    assert writing.revoke_ids == ()


def test_redelivery_of_the_same_session_does_not_count_itself():
    first = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[],
        own_id="session-1",
    )
    assert first is not None
    replay = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[
            Standing(
                id="session-1",
                key=first.key,
                area=first.learned.area,
                was=first.learned.was,
                now=first.learned.now,
            )
        ],
        own_id="session-1",
    )
    assert replay is not None
    assert replay.revoke_ids == ()
    assert replay.learned.evidence == "You changed this once"


def test_the_same_proposal_restated_reuses_the_key():
    first = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[],
        own_id="session-1",
    )
    assert first is not None
    restated = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 3 items",
        standing=[
            Standing(
                id="session-1",
                key=first.key,
                area=first.learned.area,
                was=first.learned.was,
                now=first.learned.now,
            )
        ],
        own_id="session-2",
    )
    assert restated is not None
    assert restated.key == first.key
    assert restated.revoke_ids == ("session-1",)


def test_key_is_stable_for_the_same_proposal():
    a = key_for(area="Navigation", was="Sidebar nav with 6 items", standing=[])
    b = key_for(area="Navigation", was="sidebar  nav with 6 ITEMS", standing=[])
    assert a == b


def test_work_and_home_do_not_revoke_each_other():
    home = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[],
        own_id="session-1",
        hat="home",
    )
    assert home is not None
    work = plan_commit(
        was="Sidebar nav with 6 items",
        now="Sidebar nav, 4 items",
        standing=[
            Standing(
                id="session-1",
                key=home.key,
                area=home.learned.area,
                was=home.learned.was,
                now=home.learned.now,
                hat="home",
            )
        ],
        own_id="session-2",
        hat="work",
    )
    assert work is not None
    assert work.key != home.key
    assert work.revoke_ids == ()
