# watcher-runtime

Runs a watcher when its trigger fires. Internal-only on Cloud Run, invoked by
Eventarc delivering a Pub/Sub push.

```bash
python -m uvicorn app.main:app --port 8091
python -m pytest tests -q
```

## The policy is the point

`app/policy.py` is a pure function with no I/O, because it carries the product's
central promise and must be readable and exhaustively testable on its own.

Manifest FR-W4: the user sets a per-category ceiling, but **irreversible actions
always stop for review regardless of that ceiling**, and that floor is not
user-adjustable. `tests/test_policy.py` asserts this across every
action × ceiling combination — including the one a user is most likely to want
waived.

Only an org admin may lift the floor, and only with an attributable, explained
waiver. A waiver missing either is ignored rather than honoured: an
unattributable waiver is a missing check wearing a waiver's name.

## Other deliberate choices

**An ambiguous trigger pauses, it never guesses.** FR-W3: when the Clarify Gate
fires with nobody in session, the run stops as `awaiting_review` with the
question recorded, rather than resolving its own ambiguity.

**Idempotent on delivery id.** Pub/Sub is at-least-once, so the run document is
keyed on the message id and a redelivery is a no-op.

**Malformed messages are acknowledged, not retried.** A message missing
`userId` will never become valid, so returning 500 would make Pub/Sub redeliver
it forever. Transient failures *do* return 500, because those should retry.
