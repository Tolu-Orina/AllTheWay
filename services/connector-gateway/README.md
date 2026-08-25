# Agent Gateway

The single policy enforcement point in front of every connector.

```
orchestrator / watcher  ──A2A──▶  Agent Gateway  ──MCP──▶  calendar
                                        │
                          scope · autonomy floor · confirmation
                          rate limit · quota · response screening
```

Internal-only. Reachable by the orchestrator and the watcher runtime — the two
things that act — and by nothing else. The browser has no path to a connector
that does not pass through here.

## A2A inward, MCP outward

They answer different questions. **A2A** is agent-to-agent: two things that plan
and reason, discovering each other by card. **MCP** is agent-to-tool: one thing
that reasons, calling something that does not.

A calendar does not plan, so it is a tool. Publishing an AgentCard for it would
be advertising agency it does not have.

## One path to a side effect

Every connector call goes through `service.invoke`. That is the point: one place
to audit, rate limit and screen, rather than policy that is subtly different in
each connector — where the one that is wrong is the one nobody looked at.

There is deliberately no raw-MCP passthrough skill. A second entrance is a
second place to enforce, and the requirement this service exists to meet is that
there is exactly one.

## It re-checks what the orchestrator already checked

Not redundancy. The confirm gate (FR-V2) runs where the plan is made; this runs
where the effect happens. If the orchestrator were compromised, buggy, or simply
skipped — a watcher calling directly, a surface nobody has written yet — an
irreversible action still cannot execute without a confirmation to point at.

A check that only runs on the honest path is documentation, not a control.

| outcome | A2A state |
|---|---|
| allowed | `COMPLETED` |
| needs a human to say yes | `INPUT_REQUIRED` |
| out of scope, rate limited, unregistered | `REJECTED` |

`INPUT_REQUIRED` is reserved for refusals a person could clear by answering.
Returning the others that way would invite a caller to ask a user to approve
something that will be refused anyway.

## Severity lives here, not in the connector

`registry.py` says what each tool does in the world. A connector describing its
own blast radius is a connector that can understate it.

It is fail-closed: a tool absent from the registry is refused. A connector that
gains `wire_transfer` in a new version does not gain the ability to call it by
shipping — someone adds a line, in a diff a human reads.

## Reads are not governed by the autonomy floor

The floor governs *effects*. Reading a calendar has none, so `list_events` is
checked against scope and limits only. Routing reads through the floor refused
`list_events` under a `draft_only` ceiling — a ceiling doing something it was
never about.

## Responses are screened

Whatever a connector returns is text a stranger wrote: an event title, an
invite body, a document name. It is exactly the content the manifest requires
screening on, and this is where it enters. Flagged content is **dropped**, not
returned with a warning — a caller handed flagged content alongside a warning
will use the content.

## Known limitations, written down rather than hidden

- **Usage counters are per instance.** With N Cloud Run instances the effective
  limit is N times the configured one. Enough to stop a runaway loop and a
  misconfigured watcher; not enough to stop a determined caller. The fix is a
  shared counter, and `UsageStore` is the seam for it.
- **Grants are trusted from the caller**, because grants live in the API
  gateway's Firestore and this service has no database. A compromised caller
  could widen its own scope — what it cannot widen is the floor, which is
  enforced here regardless of what the grant says.
- **The calendar store is in memory.** A real Google Calendar connector needs
  OAuth and a consenting user. What is proven is the part that is ours:
  discovery, refusal, execution, screening. Swapping the module changes nothing
  above it.
- **`mcp` is pinned to `<2`.** 2.x restructures the server API
  (`mcp.server.fastmcp` → `mcp.server.mcpserver`). The local environment
  resolved 1.26 and the image resolved 2.1.0 from the same manifest; only the
  image build noticed.

## Running it

```bash
python -m uvicorn app.main:app --port 8094
python -m pytest tests -q      # launches the calendar server as a real subprocess
```
