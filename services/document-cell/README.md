# Document cell

A bounded leaf, the same shape as the research cell: one call after Yes,
workers invisible, bounds in code, degrade instead of looping.

It is **not** a second product orchestrator. The turn graph still plans.
The person still confirms. After Yes this service:

1. **Planner** (Gemini 3.7 Flash, fresh call) maps the story brief onto the
   eleven Office layouts, backgrounds, stills, and x/y.
2. **Worker** (code) generates planned stills, compiles the PPTX, screenshots
   it in LibreOffice.
3. **Judge** (Gemini 3.7 Flash, a different call, no planner transcript) scores
   the screenshots. It cannot rewrite the plan. Fail → planner again.

Neither model talks to the person (FR-10). Visual QA is never skipped. If
the score is below 95, the planner runs again, up to 6 turns. After 6 turns
the last valid compile is persisted even if the score is still below 95
(`criticPassed` stays false).

Locally this machine needs LibreOffice (`soffice`). Set `LIBREOFFICE_BIN`
if it is not in the default install path. The Cloud Run image installs
Impress and Carlito (Calibri metrics) so prod is the same loop.

Archetypes live in `services/document-cell/references/` (also `SLIDE_REFERENCE_DIR`).
Planner and judge both see them. They never share a conversation.

## Bounds (code, not a prompt)

| Bound | Cap |
|---|---|
| Turns | 6 (plan + compile + screenshot + judge each turn) |
| Pass threshold | score >= 95 |
| Images | 8 per artifact |
| Supports per slide | 4 |
| Wall clock | 240s without images, 420s with |
| Recursion | none |

## Local

```
npm run dev:document
```

Listens on `:8095`. Start it with `npm run dev:document` while the gateway
uses the emulator: Yes then POSTs `/compile` here. If the cell is down, Yes
degrades to the in-process renderer (same loop, still needs LibreOffice).
Production always sets `DOCUMENT_CELL_URL`.
