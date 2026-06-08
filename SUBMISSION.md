# GitLab Oracle — Devpost Submission

> Paste/adapt into the Devpost "text description". Fill the two URLs before submitting.

- **Hosted project URL:** https://gitlab-oracle-ui-4delfm4yta-uc.a.run.app
- **Code repository:** `<public repo URL>` (MIT licensed, visible in About)
- **Demo video:** `<YouTube/Vimeo link, ≤3 min>`
- **Track:** GitLab

## Inspiration
Every team's hardest-won knowledge — *why* a design was chosen, what was tried
and abandoned, which approach caused an outage — lives in its Git history and
then evaporates when people leave or simply forget. Today's AI coding tools are
stateless: they see the current code but are blind to its entire past, so teams
keep re-paying for lessons they already learned. We wanted an agent that is less
a code assistant and more a **historian** — and one that doesn't just *answer*
but actively *scores* new work against the team's memory.

## What it does
GitLab Oracle ingests a repository's commits, merge requests, review threads,
and issue resolutions into a **reversion-aware knowledge graph**, then exposes
four surfaces in a single Cloud Run UI:

1. **🎯 Risk Radar** — paste any MR's title, description, and touched files; get
   a **0–100 risk score** with explainable reasons, each one a clickable
   citation. The score combines (a) nearest-neighbor matching against past
   *reverted* approaches, (b) per-file revert history (hotspot weighting), and
   (c) bus-factor signals. Not a black box — every reason and weight is shown.
2. **🕸️ Knowledge Graph Explorer** — interactive force-directed view of the
   repo's decisions and their reversion edges, rendered in red. The first time
   most teams can *see* their own reversion patterns.
3. **🔥 Hotspots & Bus-Factor** — file-level ranking by
   `churn × revert weight × decision density`, with generated-file noise
   filtered out. Flags single-owner files with high churn (the "if Alice
   leaves, we're stuck" list).
4. **💬 Grounded chat** — *"Why is the payment path built this way?"* returns a
   narrative traced through the commits, MR, and incident issue that drove it,
   every claim grounded in a clickable citation. *"I come from Django — what
   will surprise me here?"* surfaces the architectural decisions most likely to
   trip up that background.

A **GitLab webhook** ties it all together: on every new MR the agent
automatically runs the Risk Radar's reversion check and, if a prior reverted
attempt exists, posts a comment on the MR citing it — no human action required.
This is the demo money shot.

## How we built it
- **Gemini 2.5 Pro on Vertex AI**, orchestrated with the **Agent Development
  Kit (ADK)** and deployable to **Vertex AI Agent Engine** (managed runtime).
- **GitLab official MCP server** (`/api/v4/mcp`, streamable HTTP) as the
  partner integration — the agent uses it for live reads of the current MR and
  to post comments on GitLab. *(Required partner-MCP integration.)*
- **Vertex AI Vector Search** (streaming index) for semantic recall over every
  commit, MR, issue, and decision, embedded with `text-embedding-005`.
- **Firestore** holds the reversion-aware graph: commit / MR / issue / decision
  nodes with reversion and cross-reference edges mined from GitLab's linking
  syntax. A `DecisionNode` is emitted alongside every commit/MR that smells
  architectural (keywords like *refactor*, *rollback*, *postmortem*, etc.), and
  a post-ingest pass links every reverted decision back to the MR it killed.
- **Risk-scoring layer** (`agent/insights.py`) runs over the graph: explainable
  0–100 scores, file hotspots with noise filtering, and a Knowledge Graph
  endpoint that powers the interactive view.
- **Cloud Run** hosts the MR webhook and the UI; **Secret Manager** holds the
  GitLab token and webhook secret.
- **Arize Phoenix** OpenTelemetry tracing makes every tool call and reasoning
  step observable.

### The five memory tools the agent calls
`lookup_reference` (live GitLab REST for exact `!MR`/`#issue`/SHA),
`search_decision_history` (semantic), `get_reversion_history`,
`explain_code_decision` (chronological commit timeline + decisions),
`onboarding_brief`. Each returns JSON with `citations` so every answer is
grounded.

## Google Cloud services used
Vertex AI (Gemini + embeddings), ADK, Agent Engine, Vertex AI Vector Search,
Firestore, Cloud Run, Secret Manager, Cloud Build.

## Challenges we ran into
- **Scale:** the source repo (`gitlab-org/gitlab`) has 1M+ commits, so a full
  backfill isn't feasible for a hackathon demo. We ingest a **curated,
  reversion-rich slice** — recent commits/MRs/issues in a 2-year window, plus a
  targeted `Revert` pre-pass that guarantees real reverted MRs land in the
  memory regardless of the cap. All caps are env-tunable for a fuller backfill
  on smaller repos.
- **Embedding limits:** batching had to respect the 20k-token-per-request cap;
  we pack batches under a conservative token budget while keeping full text in
  Firestore.
- **Fork semantics:** GitLab forks copy commits but not MRs/issues, so we
  ingest the upstream's institutional memory and use the fork as the live demo
  surface.
- **Avoiding false-positive citations:** `#123` and `!123` shorthand appears in
  prose all the time; we deliberately drop bare `#123` matching and only follow
  explicit keyword forms (`Closes #12`) or full URLs, so the graph's edges are
  real.

## What we learned
Git history is an extraordinarily under-used dataset. Most "why" questions
about a codebase already have answers buried in a reverted MR or an incident
thread — they just aren't retrievable. Framing retrieval around *decisions and
reversions* (not just code) — and then *scoring new work* against that graph
instead of just answering questions about it — is what makes the agent feel
like memory rather than search.

## What's next
Gemini-based decision classification (replacing the regex pre-pass for higher
recall), blame-level explanations, Slack/issue notifications, and continuous
incremental ingestion so the memory stays current as the repo evolves.
