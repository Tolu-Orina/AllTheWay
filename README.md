# AllTheWay

A companion that talks with you, watches and acts for you, and remembers how you
think — with everything it does visible and auditable.

```
├── web/                      React SPA. Marketing at /, the product at /app.
├── services/
│   ├── contracts/            zod schemas shared by web and gateway
│   ├── gateway/              Express + firebase-admin. The only public service.
│   ├── orchestrator/         The graph: Clarify Gate, Plan Panel.
│   ├── watcher-runtime/      Runs watchers. Owns the autonomy floor.
│   └── profile-synthesizer/  Turns corrections into learned preferences.
├── infra/                    Terraform: one GCP project, dev + prod workspaces.
└── docs/                     Product manifest, architecture, roadmap.
```

`contracts` lives under `services/` because the services define the wire format;
`web` consumes it. Renaming a field on one side fails the build on the other.

## Running locally

Needs a JDK (the Firestore and Pub/Sub emulators are Java processes).

```bash
npm install
npm run dev:emulators     # firestore, auth, pubsub
npm run seed              # once
npm run dev:gateway       # :8080
npm run dev:orchestrator  # :8090
npm run dev:watchers      # :8091
npm run dev:synth         # :8092
npm run dev:web           # :5173, proxies /api to the gateway
```

`npm run typecheck` covers contracts + gateway; `npm run test:py` covers the
three Python services; `npm --workspace web run build` covers the client.

## Where the important rules live

| Rule | File |
|---|---|
| Irreversible actions always stop for review | `services/watcher-runtime/app/policy.py` |
| Ambiguous requests never get acted on | `services/orchestrator/app/graph.py` |
| Every request is authorised server-side | `services/gateway/src/auth.ts` |
| One definition of every wire type | `services/contracts/src/index.ts` |
| Design tokens, one value per axis | `web/src/globals.css` |

Each of those has a README beside it explaining the choices, and tests that fail
if the rule is broken.
