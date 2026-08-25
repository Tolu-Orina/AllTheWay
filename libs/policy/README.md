# alltheway-policy

The autonomy floor, as one pure function with no I/O.

```python
from alltheway_policy import Action, Ceiling, decide

decide(Action.SEND_EXTERNAL, Ceiling.SEND_AUTOMATICALLY).execute  # False
```

## Why this is a library and not a service

Every other boundary in this system is A2A. This one deliberately is not.

`decide` is a pure function over two enums. Putting it behind a network call
would add a hop, a failure mode, and a timeout to a decision that needs no
model, no database, and no I/O — and would make the floor unavailable exactly
when the network is degraded, which is when you least want an action to proceed
unchecked.

A2A is for boundaries between *agents*. This is a shared *rule*.

## Why it is shared rather than copied

Manifest FR-W4 and FR-V2 are the same rule reached from two directions: a
watcher deciding whether to act unsupervised, and a voice turn deciding whether
to speak a confirmation before acting. Two copies of a safety rule drift, and
the drift is silent — one surface tightens, the other does not, and nothing
fails until something irreversible happens on the surface that was not updated.

Consumers:

| service | why |
|---|---|
| `watcher-runtime` | FR-W4 — may this run act without me? |
| `orchestrator` | FR-V2 — must this turn stop and confirm first? |
