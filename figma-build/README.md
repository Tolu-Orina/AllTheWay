# AllTheWay — Figma build scripts

File: https://www.figma.com/design/0iGGq63HtoqO2QgTut7Wt0/Untitled
Steps 1–4 are already applied. Steps 5–8 below are blocked only by the Figma MCP
call quota (Starter plan = 20 tool calls/month, exhausted 2026-08-23).

Run each file's contents as the `code` argument to `use_figma` with
fileKey `0iGGq63HtoqO2QgTut7Wt0`, in order. Each is one call.

| Step | File | What it does | Status |
|---|---|---|---|
| 1 | — | Color + Layout variables, text/effect styles | done |
| 2 | — | Button / Logo / Badge / Nav Link / Feature Card / Pricing Card | done |
| 3 | — | Desktop 1440 skeleton, 12-col grid, 7 sections | done |
| 4 | — | Nav, Hero (walkways + app preview), Pillars | done |
| 5 | 05-trust.js | Trust band (plum, two columns, 4 guarantees) | pending |
| 6 | 06-pricing.js | Free / Plus / Team pricing row | pending |
| 7 | 07-cta-footer.js | Closing CTA band + footer | pending |
| 8a | 08a-tablet.js | Clone to Tablet 768, adapt layout | pending |
| 8b | 08b-mobile.js | Clone to Mobile 390, adapt layout | pending |

## Node IDs

Pages          landing 0:1 · design system 2008:2
Desktop frame  2012:22
Sections       Nav 2012:23 · Hero 2012:24 · Pillars 2012:25 · Trust 2012:26
               Pricing 2012:27 · CTA 2012:28 · Footer 2012:29
Components     Button set 2008:12 (Primary 2008:5, Secondary 2008:8, Ghost 2008:11)
               Logo 2009:7 · Badge 2009:10 · Nav Link 2009:13
               Feature Card 2010:7 · Pricing Card 2012:21
Properties     Button Label#2008:0 · Badge Label#2009:0 · Nav Link Label#2009:1
               Feature Card Title#2010:0 Body#2010:1
               Pricing Card Plan#2012:0 Price#2012:1 Period#2012:2 Tagline#2012:3
                            "Feature 1#2012:4" "Feature 2#2012:5" "Feature 3#2012:6"

## API gotchas already hit (do not reintroduce)

- `vectorPaths` data must be space-delimited. Commas throw "Invalid command at ,".
- Setting `vectorPaths` re-normalizes geometry to the bbox; reset `x`/`y` afterwards.
- `node.query()` has no escape syntax — selectors with spaces in the name fail.
  Iterate `children` and match on `name` instead.
- Figma nodes reject arbitrary JS properties (`node._foo = x` throws).
- `counterAxisAlignItems` has no `STRETCH`. For equal-height columns, set each
  child's `layoutSizingVertical = 'FILL'` after appending.
- Variable collections are capped at 1 mode on Starter, so the responsive token
  set is single-mode; breakpoints are handled by auto-layout + constraints.
