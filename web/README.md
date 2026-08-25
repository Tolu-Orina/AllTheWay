# AllTheWay — web

Marketing site and (next) PWA app shell for AllTheWay.

- **Vite + React 19 + TypeScript**, Tailwind v4, shadcn/ui (Base UI), Motion, Lucide.
- **Installable PWA** — `vite-plugin-pwa` generates the manifest and a Workbox
  service worker; fonts are self-hosted so the app works offline.
- **Prerendered** — `npm run build` renders each route in a real browser and writes
  the HTML back into `dist`, so crawlers and the first paint get real content
  instead of an empty `#root`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck → bundle → prerender routes |
| `npm run build:nossg` | Build without the prerender step |
| `npm run preview` | Serve `dist` |
| `npm run lint` | oxlint |
| `npm run shots` | Renders desktop/mobile × light/dark into `screenshots/` |
| `npm run audit:overflow` | Fails-loud report of any element breaking the mobile viewport |
| `npm run audit:contrast` | WCAG AA contrast sweep over every rendered text node, both themes |
| `npm run verify` | Loads the built page and reports console/page errors |

The audit scripts drive the installed Edge via `playwright-core` — no browser download.

## Design system

Every value lives in `src/globals.css`. Components read **semantic** tokens only
(`bg-card`, `text-muted-foreground`), never a raw hex — rebranding means editing
that one file.

- **Derived from the brand mark.** Every hue is sampled from
  `public/android-chrome-512x512.png` rather than invented.
- **Accent**: orange `#fb9d24` is the *only* primary-action colour — it mirrors
  the arrow tip in the logo. Blue/violet/magenta carry brand voice (eyebrows,
  gradients, ambient, the trust band) and must never dress a CTA. Using indigo
  for buttons is the exact SaaS cliché the landing-page skill warns about; the
  warm accent against a cool ground is what keeps this page off that template.
- **Neutrals**: blue-biased porcelain `#f3f6fd` and navy ink `#0b1533` — chosen,
  not stock grey, and never pure white/black.
- **Focus ring is blue, not the accent.** `#fb9d24` scores 1.95:1 against the page
  ground, well under the 3:1 floor for non-text UI. A11y beats token purity here.
- **Radius**: two tiers only — `--radius-brand` 12px, `--radius-brand-lg` 20px.
- **Separation**: cards are *outlined*; real elevation is reserved for genuinely
  floating surfaces (the hero panel, the header once scrolled).
- **Spacing**: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 only.
- **Containers**: nav, hero and footer take **no max-width at all**
  (`w-full px-4 sm:px-6 lg:px-8`) — they are page chrome, not content. Body
  sections stay contained at `max-w-[1280px]` for line length. The left-edge jog
  between the two is intentional; do not re-cap the chrome to "align" them.
- **Type**: Poppins only — one family for display, UI and body, self-hosted via
  `@fontsource`. There is deliberately no second/display face and no `font-display`
  utility; headings differentiate by size, weight and `tracking-[-0.015em]`.
  `npm run shots` plus the font sweep should always report a single family.
- **Themes**: light and dark are designed as peers. Values are declared once as
  `--l-*` / `--d-*` and mapped in three states — `:root` (light default),
  `@media (prefers-color-scheme: dark) :root:not(.light)` (OS preference), and
  `:root.dark` (explicit choice). Adding a `.light`/`.dark` class on `<html>`
  is all a future theme toggle needs.

### Colours that must not be eyeballed

The display gradient and the CTA gradient are `background-image`, so automated
contrast tools read them as `transparent` and report a false failure. Their stops
were verified numerically instead:

| Surface | Worst stop | Ratio | Floor |
|---|---|---|---|
| Hero gradient text, light | `#0269e6` on `#f3f6fd` | 4.66 | 3.0 (large) |
| Hero gradient text, light | `#c92c72` on `#f3f6fd` | 4.75 | 3.0 (large) |
| Hero gradient text, dark | `#ae44d1` on `#060d24` | 4.17 | 3.0 (large) |
| Brand CTA, light | label on `#fb9d24` | 8.25 | 4.5 |
| Brand CTA, dark | label on `#fbb21e` | 9.53 | 4.5 |

Dark needs its own gradient stops — the light set sinks below the floor on navy.
Do not collapse them into one set. The light gradient ends in magenta rather than
orange because orange scores only **1.95:1** on the light ground; orange is the
action colour, not a display-text colour.

## Component ownership

```
src/components/
├─ ui/          raw shadcn primitives — safe to re-run `npx shadcn add`
├─ primitives/  project-level pieces (Logo, Link, Reveal)
└─ blocks/      product compositions (Hero, Pillars, Pricing, …)
```

Motion lives only in `primitives/reveal.tsx` and block-level wrappers, never
inside `ui/`. Under `prefers-reduced-motion` the reveal wrappers render plain
elements — content must never depend on an animation, or an IntersectionObserver,
to become visible.

## Imagery

`src/components/blocks/in-practice.tsx` is the only section using photography.
Everything else argues with product UI rendered as live DOM, which stays crisp,
themes itself, and costs no bytes — the correct medium for software with nothing
physical to photograph.

Photos are sourced from **Pexels** (Pexels License: free commercial use, no
attribution required); credits are recorded in `public/images/CREDITS.md` anyway.
`scripts/prepare-photos.mjs` fetches and grades them — one 16:10 crop, saturation
at 0.72, and a warm amber soft-light pass so they seat against the parchment
ground instead of reading as a stock-library grab bag. Outputs are committed;
re-run only if the photo set changes.

If you add photos elsewhere, they must use this same treatment, and the card grid
they live in must be image-led throughout — mixing photo cards and icon-only cards
in one grid is what makes a page look assembled.

## Icons

Source of truth is `public/android-chrome-512x512.png` (supplied by the brand
owner). `scripts/generate-icons.mjs` derives the Android maskable icon (mark inset
into the 80% safe zone) and the small header mark. The favicon/apple-touch set is
used as supplied. Regenerating needs `sharp`.

Install-time icons and marketing photos are deliberately excluded from the service
worker precache (`globIgnores` in `vite.config.ts`) — precaching them cost ~350 KB
of offline budget for no benefit.
