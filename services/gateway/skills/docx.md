# Word document skill

Use this whenever the person asked for a Word document, .docx, board brief,
memo, proposal, or a file they will open in Word. Do not dump markdown into a
blank page. The gateway renderer (`office-document.ts`) designs the page —
masthead, header, footer, tables, labelled bullets — but only if the body is
a real document.

This is the planner half. The renderer never invents Microsoft 365, never
skips Yes, and never writes to Drive.

Prefer **report.v1** when the request is a designed brief:

```json
{
  "ir": "report.v1",
  "title": "Q4 launch",
  "audience": "the Board",
  "kind": "briefing",
  "sections": [
    { "heading": "Executive Summary", "body": "Overview of the Q4 product launch." },
    { "heading": "Launch goals", "bullets": ["**Revenue:** Hit the Q4 ARR milestone."] },
    { "heading": "Milestones", "table": [["When", "What"], ["T-4 weeks", "Feature freeze"]] }
  ]
}
```

## Legacy arguments (still compiled)

- `title` — the document title, once. Short. No trailing punctuation.
- `body` — the full content as markdown. This is what Yes writes.
- `kind` — `briefing` | `memo` | `proposal` | `report` | `contract` when known.
- `audience` — who it is for, e.g. `the Board`.

Do not also start `body` with `#` that repeats `title`. The renderer prints
the title as a Title style. A second H1 of the same words is a dump.

## Body shape

1. One short **Executive Summary** paragraph (plain prose, not bullets).
2. `##` sections. Action titles, not labels like "Section 2".
3. `| tables |` for anything tabular: milestones, asks, numbers, owners.
4. `- **Label:** rest of the sentence` for goals, risks, asks.
5. Specific numbers, dates, named owners. Never "lorem", "TBD", or "as needed".

## Renderer contract (already implemented)

- A4, Arial, AllTheWay navy, header + page numbers, confidential footer.
- Duplicate titles are stripped.
- Executive Summary becomes a shaded callout.
- Markdown tables become navy-header tables with dual DXA widths.
- Unicode bullets are never inserted; numbering config is used.

If they asked for a Google Doc in Drive, that is `google_docs`, not this.
