# DevGenie — Devpost Submission

> Paste/adapt into the Devpost "text description".

- **Hosted project URL:** https://devgenie-app-70965519212.us-central1.run.app (sign in with GitLab)
- **Backend API (+ legacy analytics UI):** https://devgenie-70965519212.us-central1.run.app
- **Code repository:** https://github.com/vedant-moxie/gitlab-oracle (MIT licensed)
- **Demo video:** https://youtu.be/AJ3HZKXIhn0
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
DevGenie is a multi-tenant SaaS: any engineer signs in with GitLab, points it at
a repo they can read, and gets an institutional-memory agent backed by a
**reversion-aware knowledge graph** of that project's commits, MRs, and issues.

1. **🎯 Risk Radar** — paste an MR's title, description, and touched files;
   get a **0–100 risk score** with explainable reasons, each one a clickable
   citation. The score combines (a) nearest-neighbor matching against past
   *reverted* approaches, (b) per-file revert history (hotspot weighting), and
   (c) bus-factor signals. Available as a one-click modal in the chat UI and as
   a `POST /risk` endpoint.
2. **🤖 Webhook auto-review** — a GitLab webhook fires on every new MR. The
   agent fetches the **live diff via the GitLab MCP server**, looks up
   reverted precedents in the team's memory, computes a risk score, and posts
   a comment on the MR led by an explainable risk badge (e.g. *"🔴 Risk: HIGH
   (78/100) — Closely matches a previously REVERTED approach: !237909"*).
   Every comment cites at least one file path confirmed by the live MCP fetch,
   prefixed with `[live via MCP]` so reviewers can see live data was used.
   On merge, the same webhook triggers an incremental re-ingestion so the
   memory stays current.
3. **💬 Grounded chat** — *"Why is the payment path built this way?"* returns
   a narrative traced through commits, MR, and the incident issue that drove
   it, every claim a clickable citation. *"Who wrote line 142?"* hops through
   live `git blame` → commit → linked MR → discussion. *"I come from Django —
   what will surprise me here?"* surfaces architectural decisions most likely
   to trip up that background.
4. **🔥 Hotspots & Bus-Factor** — file-level risk ranking by
   `churn × revert weight × decision density`, with single-owner / high-churn
   files flagged as "if Alice leaves, we're stuck" candidates.
5. **🕸️ Knowledge Graph Explorer** — interactive force-directed view of the
   repo's decisions and their reversion edges, rendered red.
6. **🔔 Slack notifications** — every auto-posted MR comment also lands in
   the configured Slack channel.

## How we built it
- **Next.js 16 frontend with NextAuth** — sign in with GitLab OAuth, refresh
  tokens rotated automatically; the user's GitLab token flows through Bearer
  headers to the backend so they can only query repos they can already read.
- **Gemini 2.5 Pro on Vertex AI** with `temperature=0`, orchestrated through
  the **Agent Development Kit (ADK)** and deployable to **Vertex AI Agent
  Engine**. 8 plain-function tools, each wrapped in a `_safe_tool` decorator
  so a Vector Search outage degrades to an error payload the agent can
  reason about, instead of crashing the run.
- **GitLab official MCP server** (`/api/v4/mcp`, streamable HTTP) as the
  partner integration. The webhook's MR-review prompt **mandates** a live
  MCP fetch before any history search; the chat side routes any "what does
  THIS look like RIGHT NOW" question to MCP, tagged `[live via MCP]`.
  *(Required partner-MCP integration.)*
- **Vertex AI Vector Search** (streaming index) for semantic recall over
  every commit / MR / issue / decision, project-scoped via `type` +
  `project_id` namespace restrictions.
- **Firestore** holds the reversion-aware graph, project-scoped under
  `projects/<encoded-id>/` for multi-tenancy. A `DecisionNode` is emitted
  alongside every commit/MR that smells architectural; a post-ingest pass
  links every reverted decision back to the MR it killed.
- **Risk-scoring layer** (`agent/insights.py`) — explainable 0–100 scores,
  file hotspots with noise filtering, and a `/graph` endpoint with reversion
  edges flagged red.
- **Parallel ingestion** — three phases (issues / MRs / commits) run
  concurrently in a `ThreadPoolExecutor`; inside each phase the diff and
  notes fetches are also parallelized with 8 workers. A backfill of a large
  repo finishes in minutes, not hours.
- **Cloud Run** hosts the FastAPI backend (chat / ingest / risk / graph /
  hotspots) and the MR webhook; **Secret Manager** holds the GitLab token
  and webhook secret.
- **Arize Phoenix** OpenTelemetry tracing makes every tool call and reasoning
  step observable.

### The nine memory tools the agent calls
`lookup_reference` (live GitLab REST for exact `!MR`/`#issue`/SHA),
`get_commit_diff` (real patch text so the agent explains changes line by line),
`search_decision_history`, `get_reversion_history`, `explain_code_decision`,
`onboarding_brief`, `explain_blame` (live `git blame` → commit → MR),
`get_recent_activity`, `get_repository_structure` (live tree + README + language
breakdown). Each returns JSON with `citations` so every answer is grounded.

## Google Cloud services used
Vertex AI (Gemini + embeddings), ADK, Agent Engine, Vertex AI Vector Search,
Firestore, Cloud Run, Secret Manager, Cloud Build.

## Challenges we ran into
- **Scale.** A repo like `gitlab-org/gitlab` has 1M+ commits — a full backfill
  isn't feasible for a hackathon. We ingest a **curated, reversion-rich
  slice** (recent commits/MRs/issues in a 2-year window) plus a targeted
  `Revert` pre-pass that guarantees reverted MRs land in the memory regardless
  of the cap. All caps are env-tunable for a fuller backfill on smaller repos.
- **Embedding limits.** Batching had to respect the 20k-token-per-request cap;
  we pack batches under a conservative token budget and keep full text in
  Firestore.
- **Multi-tenancy.** Single-tenant ingest used top-level Firestore collections;
  multi-tenant ingest had to namespace them without breaking the existing
  legacy project's memory. Solved with `agent.store.project_col()`: the legacy
  project keeps reading top-level collections, all other projects use
  `projects/<encoded-id>/`.
- **OAuth token lifetime.** GitLab OAuth tokens expire in ~2 hours and GitLab
  rotates the refresh token on every use. NextAuth handles refresh in the JWT
  callback; the chat client surfaces a "session expired" banner if a refresh
  fails so the user can re-sign-in without losing their conversation.
- **Avoiding false-positive citations.** `#123` and `!123` shorthand appears
  in prose all the time; we deliberately drop bare `#123` matching and only
  follow explicit keyword forms (`Closes #12`) or full URLs, so the graph's
  edges are real.

## What we learned
Git history is an extraordinarily under-used dataset. Most "why" questions
about a codebase already have answers buried in a reverted MR or an incident
thread — they just aren't retrievable. Framing retrieval around *decisions
and reversions* (not just code) — and then *scoring new work* against that
graph instead of just answering questions about it — is what makes the agent
feel like memory rather than search.

## What's next
Gemini-based decision classification (replacing the regex pre-pass for higher
recall), automatic incident-issue clustering, deeper Slack/MR-comment
threading, and continuous ingestion at the commit level so the memory stays
current sub-minute as the repo evolves.
