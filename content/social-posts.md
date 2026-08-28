# Social posts — ready to publish

Both carry **#AllThingsAgenticHackathon** as the rules require. Neither is published — posting to your accounts is yours to do. Replace `[BLOG LINK]` with the live URL once the post is up.

---

## LinkedIn

> I spent the last stretch building **AllTheWay** — an AI companion that talks with you, watches and acts for you, and remembers how you work — and kept a list of every bug that reached production or nearly did.
>
> Nine of them. **Not one was catchable by a typechecker, a linter, or a passing test suite.**
>
> A few that still make me wince:
>
> → Google's frontend on `*.run.app` silently eats the exact path `/healthz`. The request never reaches your container. I proved it by *absence* — it appeared in no log, while another path from the same probe appeared instantly. `/healthz/` works. And the trailing-slash fix that saves your Node service breaks your Python ones, because FastAPI redirects straight back into the intercepted path.
>
> → A **dev** dependency (`firebase-tools`) claimed the hoisted `ws` slot with an incompatible major. npm nested my real one under the workspace. `npm prune --omit=dev` deleted the hoisted copy, my Dockerfile never copied the nested one, and the container exited before it could listen. Four packages were being dropped silently.
>
> → My confirm gate — the thing that stops the agent before anything irreversible — reads a field the model fills in. Measured against real prompts, the model marked the dangerous step in only **8 of 12 runs**. A third of the time it never fired and nobody was asked. Switching models changed nothing. So I stopped trusting the label: a validation pass now re-derives severity from the step's own wording and can only ever *escalate*, never downgrade. Re-measured against live Gemini afterwards, it had to correct **5 out of 5** plans.
>
> → And right at the end, I probed a Veo model with a valid payload to see if it existed. That endpoint doesn't report on a model — it starts a generation. Two ran before I meant them to, at about $6 each. Probing a generative endpoint is not a read.
>
> What ties them together: every single one lives at a **boundary** — between your code and a platform's frontend, a package manager's hoisting, a CI path filter, a region, a protocol upgrade, a serialiser, a model's judgment, a billing meter.
>
> Agentic systems are almost entirely boundaries. An agent is a thing that calls other things. The interesting failures are never inside a function you wrote — they're in the space between two systems that each believe they're behaving correctly.
>
> Which is why the only discipline that reliably worked was the dullest one: **verify by running.** Not by typechecking. Not by reading the docs — one of these bugs came *from* the docs. By making the actual call against the actual project and looking at what actually came back.
>
> Full write-up: [BLOG LINK]
>
> Built on Cloud Run, Vertex AI, Firestore and Firebase — A2A between agents, MCP out to tools, Model Armor screening untrusted content, and signed AgentCards so a card can't be spoofed.
>
> #AllThingsAgenticHackathon

---

## X — single post

> Built an AI agent platform on Google Cloud. Kept a list of every bug that hit production.
>
> Nine. None catchable by a typechecker.
>
> The worst: my "confirm before anything irreversible" gate reads a field the model fills in.
>
> The model forgot to fill it in 4 times out of 12.
>
> [BLOG LINK]
>
> #AllThingsAgenticHackathon

---

## X — thread (alternative)

**1/**
> Built an agentic platform on Google Cloud. Kept a list of every bug that reached production or nearly did.
>
> Nine of them. Not one catchable by a typechecker, linter, or passing test suite.
>
> 🧵 #AllThingsAgenticHackathon

**2/**
> Google's frontend on *.run.app silently eats the exact path /healthz. It never reaches your container.
>
> I proved it by absence: it appeared in NO log, while another path from the same probe appeared instantly.
>
> /healthz/ works. But FastAPI 307s that straight back into the intercepted path.

**3/**
> A dev dependency claimed the hoisted `ws` slot with an incompatible major, so npm nested my real one under the workspace.
>
> `npm prune --omit=dev` deleted the hoisted copy. My Dockerfile never copied the nested one.
>
> Container exited before it could listen. 4 packages dropped silently.

**4/**
> My confirm gate — stops the agent before anything irreversible — reads a field the model fills in.
>
> Measured on real prompts: the model flagged the dangerous step in only 8 of 12 runs.
>
> A third of the time, nobody got asked. Switching models changed nothing.

**5/**
> So I stopped trusting the label.
>
> A validation pass re-derives severity from the step's own wording, and can only ESCALATE — never downgrade.
>
> That asymmetry is the whole safety argument: nothing can talk the gate out of firing.
>
> Re-measured live: it corrected 5/5 plans.

**6/**
> Then, checking which Veo models existed, I sent a valid payload to :predictLongRunning
>
> That endpoint doesn't report on a model. It starts a generation.
>
> Two ran before I meant them to. ~$6 each.
>
> Probe with an INVALID payload: 400 means it exists and refused.

**7/**
> The pattern: every one lives at a boundary. Platform frontend, package hoisting, CI path filter, region, protocol upgrade, serialiser, model judgment, billing meter.
>
> Agentic systems are almost entirely boundaries. An agent is a thing that calls other things.

**8/**
> Which is why the only discipline that worked was the dullest:
>
> Verify by running. Not by typechecking. Not by reading the docs — one bug came FROM the docs.
>
> Make the actual call. Look at what actually came back.
>
> [BLOG LINK]
>
> #AllThingsAgenticHackathon

---

## Notes before you post

- The blog post carries the required hackathon-entry language in two places (top and bottom). Keep both if you trim. File: `content/the-invoice-the-model-forgot.md`.
- Publish **public, not unlisted** — the rules are explicit about it.
- The $6-mistake anecdote is deliberately included. It is the most credible thing in the post, and removing it would make the rest read as a highlight reel.
- Every number is real and reproducible from the repo: 8/12, 5/5, the region probes, the 1008 error. Nothing is rounded up for effect.
