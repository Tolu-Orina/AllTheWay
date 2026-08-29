# PDF skill

Use this when they asked for a PDF. Prefer **report.v1** so the compiler can
keep content out of the header and footer bands.

```json
{
  "ir": "report.v1",
  "title": "Q4 launch",
  "audience": "the Board",
  "kind": "briefing",
  "sections": [
    { "heading": "Executive Summary", "body": "Overview of the launch." },
    { "heading": "Goals", "bullets": ["**Revenue:** Hit the ARR milestone."] },
    { "heading": "Milestones", "table": [["When", "What"], ["T-4 weeks", "Feature freeze"]] }
  ]
}
```

Legacy `{title, body, kind, audience}` still compiles: same markdown shape as
the Word skill (title once, Executive Summary, `##` sections, `| tables |`,
`**Label:**` bullets). Do not also start body with that same # heading.

The renderer writes A4, Helvetica, navy chrome in reserved bands, content below
the header. This is not a scan and not a Google Doc.
