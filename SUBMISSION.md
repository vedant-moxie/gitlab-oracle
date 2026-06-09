# GitLab Oracle — Devpost Submission

> Paste/adapt into the Devpost "text description". Fill the two URLs before submitting.

- **Hosted project URL:** https://gitlab-oracle-ui-4delfm4yta-uc.a.run.app
- **Code repository:** `<public repo URL>` (MIT licensed, visible in About)
- **Demo video:** `<YouTube/Vimeo link, ≤3 min>`
- **Track:** GitLab

## Inspiration
Every team's hardest-won knowledge — *why* a design was chosen, what was tried and
abandoned, which approach caused an outage — lives in its Git history and then
evaporates when people leave or simply forget. Today's AI coding tools are
stateless: they see the current code but are blind to its entire past, so teams
keep re-paying for lessons they already learned. We wanted an agent that is less a
code assistant and more a **historian**.

## What it does
GitLab Oracle ingests a repository's full history — commits, merge requests, review
threads, and issue resolutions — into a temporal knowledge graph, and reasons over
it with Gemini:

1. **Catches repeat mistakes automatically.** A GitLab webhook fires on every new
   merge request; the Oracle checks whether the approach was tried before and posts
   a comment citing the prior attempt, why it was reverted, and what the team chose
   instead — no human action required.
2. **Explains why code exists.** "Why is the payment path built this way?" returns a
   narrative traced through the commits, MR, and incident issue that drove it, each
   answer grounded in clickable citations.
3. **Onboards new engineers.** "I come from Django — what will surprise me here?"
   surfaces the architectural decisions most likely to trip up that background.

## How we built it
- **Gemini (gemini-2.5-pro) on Vertex AI**, orchestrated with the **Agent Development
  Kit (ADK)** and deployable to **Vertex AI Agent Engine** (managed runtime).
- **GitLab official MCP server** (`/api/v4/mcp`, streamable HTTP) as the partner
  integration — the agent uses it for live reads of the current MR and to act on
  GitLab. *(Required partner-MCP integration.)*
- **Vertex AI Vector Search** (streaming index) for semantic recall over every
  commit/MR/issue/decision, embedded with `text-embedding-005`.
- **Firestore** holds the temporal knowledge graph: commit/MR/issue/decision nodes
  with reversion and cross-reference edges mined from GitLab's linking syntax.
- **Cloud Run** hosts the MR webhook and the chat UI; **Secret Manager** holds the
  GitLab token and webhook secret.
- **Arize Phoenix** OpenTelemetry tracing makes every tool call and reasoning step
  observable.

### The four memory tools
`search_decision_history`, `get_reversion_history`, `explain_code_decision`,
`onboarding_brief` — each combines Vector Search recall with Firestore graph hops
and returns grounded citations.

## Google Cloud services used
Vertex AI (Gemini + embeddings), ADK, Agent Engine, Vertex AI Vector Search,
Firestore, Cloud Run, Secret Manager, Cloud Build.

## Challenges we ran into
- **Scale:** the source repo (`gitlab-org/gitlab`) has 1M+ commits. We sample a
  bounded, recent slice plus a targeted "Revert" pass so the memory is rich and the
  backfill is fast.
- **Embedding limits:** batching had to respect the 20k-token-per-request cap; we
  pack batches under a token budget while keeping full text in Firestore.
- **Fork semantics:** GitLab forks copy commits but not MRs/issues, so we ingest the
  upstream's institutional memory and use the fork as the live demo surface.

## What we learned
Git history is an extraordinarily under-used dataset. Most "why" questions about a
codebase already have answers buried in a reverted MR or an incident thread — they
just aren't retrievable. Framing retrieval around *decisions and reversions* (not
just code) is what makes the agent feel like memory rather than search.

## What's next
Issue notifications natively and expanding blame-level explainability to larger diff chunks.
