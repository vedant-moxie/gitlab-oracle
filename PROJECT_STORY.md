# DevGenie — Project Story

## Inspiration

Research shows developers spend **~58% of their time just understanding existing code** (Xia et al., IEEE TSE 2018) — and the hardest question is never *what* the code does, it's ***why***. The answer usually exists: it's buried in a merge request from 2023, a review thread nobody re-reads, or a revert commit whose lesson left the company with the engineer who wrote it. Per Stack Overflow's developer surveys, **68% of developers hit a knowledge silo at least weekly**, and a 50-person team loses up to **651 hours a week** hunting for answers the repo already contains.

We kept asking: *your team already wrote the documentation — it's called git history. Why can't it answer back?*

## What it does

DevGenie is **institutional memory on demand** for GitLab repositories.

- **Grounded chat** — Sign in with GitLab, pick any repo you can read, and ask: *"Why is this built this way?"*, *"Has this been tried before?"*, *"Explain commit `2391b107` in detail"*, *"What's riskiest to touch?"*. Every claim in every answer is a **clickable citation** back to the real commit, MR, or issue.
- **Risk Radar** — paste an MR and get a 0–100 risk score with explainable reasons: reverted-precedent matches, file hotspots, bus-factor warnings.
- **Webhook auto-review** — every new MR is automatically checked against the team's reversion history via the **GitLab MCP server** (live diff) and gets a risk-badged comment *before* someone repeats a mistake the team already paid for.
- **Multi-repo, multi-tenant** — one-click "✨ Ingest this repository" for any project your OAuth token can read; memory is isolated per-project in Firestore and Vector Search.
- **Honest by design** — the agent discloses degraded capabilities and data gaps instead of bluffing, and tells you when you're reading a fork's upstream history.

## How we built it

- **Ingestion**: GitLab REST → a reversion-aware knowledge graph in **Firestore** (commits, MRs + review threads, issues, decision nodes, reversion edges) + **Vertex AI Vector Search** (text-embedding-005, project-scoped restricts). Issues/MRs/commits ingest **concurrently**, with diff/notes fetches fanned across 8 workers, and a targeted "Revert" pre-pass that guarantees reverted decisions land in the index even when sampling a 1M-commit repo like `gitlab-org/gitlab`.
- **Agent**: **Google ADK + Gemini 2.5 Pro** on Vertex AI with 9 tools — semantic decision search, reversion history, live commit-diff reading, repo structure, blame, onboarding briefs, and more. The system prompt routes by question type instead of blind semantic search, and *requires* linked citations.
- **Surfaces**: **Cloud Run** ×3 — a Next.js 16 + NextAuth frontend (GitLab OAuth with refresh-token rotation), the FastAPI backend, and the MR webhook. Secrets in **Secret Manager**, tracing via **Arize Phoenix** OpenTelemetry.

## Challenges we ran into

**1. The model bluffed before it helped.** Our biggest fights weren't infrastructure — they were getting Gemini to behave like an honest engineer. Early on it answered *"how is this repo structured?"* by dumping loosely-related commit search hits as if they were an answer, refused *"explain this commit in detail"* claiming it couldn't read code, and our own prompt was the culprit: we'd ordered it to "never ask clarifying questions, output only facts." We rebuilt the prompt around **question classification** (structural → live repo tree; detail → real patch text; time-bounded → recent activity), added tools for the data it was missing (`get_repository_structure`, `get_commit_diff`), and made honesty a hard rule: disclose degraded tools, state data gaps, never pad with pseudo-relevant hits.

**2. Stale gRPC channels froze everything.** A Vector Search upsert hung for **58 minutes** with zero CPU — the cached gRPC channel had silently died, and the SDK never times out. The same disease later broke query-time search in our long-lived server (`503 recvmsg: Operation timed out`, forever). Fix: timeouts on every upsert batch, **self-healing clients** (drop the cached channel, rebuild, retry once), and a **Firestore keyword fallback** so search degrades to labeled lexical results instead of an error.

**3. Multi-tenant retrofit on live data.** Our first ingest wrote to top-level Firestore collections and unprefixed vector IDs; the multi-tenant refactor namespaced everything under `projects/<id>/`. Queries silently returned nothing for legacy data. We had to build a compatibility layer (`project_col()`, legacy-aware ID stripping) that serves both layouts.

**4. OAuth tokens expire silently.** GitLab access tokens die after ~2 hours; our repo list just went quietly empty (401 swallowed). We implemented refresh-token rotation in NextAuth and a visible re-auth banner when rotation fails.

**5. Cloud Run source deploys kept dying mysteriously.** `gcloud run deploy --source .` was shipping **559MB of `frontend/node_modules`** — gcloud only honors the repo-root ignore file. One `.gcloudignore` later, uploads dropped to 4.5MB. A missing `GOOGLE_GENAI_USE_VERTEXAI=TRUE` then had the genai client demanding API keys in production — a one-env-var 503.

**6. The model you want isn't always the model you get.** Claude on Vertex was enabled but quota-denied; Gemini 3 Pro is allowlist-gated. So we benchmarked what we *could* get on real institutional-memory queries — **Gemini 2.5 Pro found 3 fully-cited revert chains where 3-Flash found 1** — and built a LiteLLM-based model resolver so any Model Garden model is a one-line env switch when access lands.

## Accomplishments that we're proud of

- **Every answer is verifiable.** Clickable citations to real commits/MRs/issues are a hard prompt rule — fabricated URLs are forbidden. Judges (and engineers) can cross-check every claim.
- The webhook reviewer cites at least one file confirmed by a **live GitLab MCP fetch** in every MR comment — cached history never masquerades as the current diff.
- A full **multi-tenant SaaS** — OAuth-scoped access (you can only ingest/query what you can already read), per-project isolation, one-click ingestion — built in a hackathon window.
- Backfilling a curated slice of **`gitlab-org/gitlab`** (one of the largest repos on earth) in minutes, with reverted decisions guaranteed in the index.
- An agent that says *"I don't have that data"* instead of hallucinating — which, ironically, took more engineering than making it answer.

## What we learned

- **Grounding is a systems problem, not a prompt trick.** The model bluffs exactly where your tools have gaps. Closing the gap (real diffs, live repo tree) beat any amount of prompt scolding.
- **Long-lived cloud clients need self-healing.** Cached gRPC channels die quietly; every singleton needs a timeout + reset-and-retry path, and every retrieval path needs a fallback.
- **Tenancy is much cheaper on day one** than retrofitted onto live data.
- **Benchmark models on your task, not the leaderboard.** A generation-newer Flash lost to an older Pro on multi-step tool-calling synthesis — the tier mattered more than the generation.
- Always read what `--source .` actually uploads.

## What's next for DevGenie

- **Org-wide memory**: cross-repo search and decision graphs spanning a whole GitLab group — "has *any* team here tried this?"
- **Proactive surfacing**: a weekly "institutional risk report" (rising hotspots, bus-factor alerts) and IDE inline hints on risky lines.
- **Deeper graph**: incident links (post-mortems → reverts → re-attempts), CODEOWNERS-aware expert routing for "who should I ask?".
- **Self-hosted GitLab & GitHub support**, and Agent Engine as the fully-managed runtime.
- **Claude/other models in production** via our LiteLLM resolver once quota lands — the switch is already one env var.
