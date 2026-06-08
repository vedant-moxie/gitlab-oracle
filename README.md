# GitLab Oracle — Institutional Memory Agent

> *AI coding tools see today's code but are blind to its past.*
> GitLab Oracle ingests a repository's commits, merge requests, review threads, and
> issue resolutions into a **reversion-aware knowledge graph**, then scores new
> merge requests against it with **Gemini** so the team never re-pays for a
> lesson it already learned.

Built for the **Google Cloud Rapid Agent Hackathon — GitLab track**.

**Live UI:** https://gitlab-oracle-ui-4delfm4yta-uc.a.run.app

---

## The product surfaces

Four things a judge sees when they open the live URL.

### 🎯 Risk Radar — score any MR against the team's memory
Paste an MR title, description, and touched files. Get a **0–100 risk score** and
the *reasons* behind it — each one a clickable citation back to the commit, MR,
or issue that drove it.

> **Score: 78 — HIGH.** Closely matches a previously **REVERTED** approach: !237909
> *"Use Sidekiq for inline auth checks."* Touches `app/services/auth/login.rb` —
> 3 prior reverts here. One author owns this file (bus factor 1).

Powered by `POST /risk` (`agent/insights.py`). Combines nearest-neighbor reversion
lookup, file hotspot weighting, and bus-factor analysis. Every reason is
explained, not a black box.

### 🕸️ Knowledge Graph Explorer — reversion edges, in red
An interactive force-directed view of the repo's *decisions* and the MRs and
issues they connect to. Reverted decisions and their kill-edges render red.
Click any node to jump straight to GitLab.

Powered by `GET /graph`. The first time most teams can *see* their own reversion
patterns.

### 🔥 Hotspots & Bus-Factor — where institutional risk concentrates
File-level ranking by `churn × revert weight × decision density`, with
lockfile / generated-file noise filtered out. Flags files with a single owner and
high churn — the *"if Alice leaves, we're stuck"* list.

Powered by `GET /hotspots`.

### 💬 Chat — grounded answers with citations
Ask *"why is the payment path built this way?"* — get a narrative traced through
commits, MRs, and the incident issue that drove it. Every claim is a clickable
citation. New engineer onboarding: *"I come from Django — what will surprise me
here?"* → architectural decisions most likely to trip up that background.

### 🤖 Webhook auto-review — runs without anyone asking
GitLab webhook fires on every new MR → the agent checks for prior reverted
attempts of the same approach → if found, it posts a comment on the MR citing
what was tried, when, why it failed, and what the team chose instead. Zero
human action required.

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              GitLab (upstream repo)          │
                    │  commits · MRs · issues · review threads     │
                    └──────────────────┬──────────────────────────┘
                                       │ REST API (backfill)
                              ┌────────▼────────┐
                              │  ingestion/     │  python-gitlab
                              │  embed.py       │  text-embedding-005
                              └───┬─────────┬───┘
                         Firestore│         │Vector Search
                    ┌─────────────▼──┐  ┌───▼──────────────────┐
                    │  Reversion-    │  │  Vertex AI            │
                    │  aware graph   │  │  Vector Search        │
                    │  (decisions +  │  │  (semantic recall)    │
                    │  revert edges) │  │                       │
                    └─────────────┬──┘  └───┬──────────────────┘
                                  │          │
                    ┌─────────────▼──────────▼──────────────────┐
                    │            agent/  (ADK + Gemini 2.5 Pro) │
                    │  lookup_reference                          │
                    │  search_decision_history                   │
                    │  get_reversion_history                     │
                    │  explain_code_decision                     │
                    │  onboarding_brief                          │
                    │  + GitLab MCP (live MR read / comment)    │
                    └──────────┬───────────────────┬────────────┘
                               │                   │
              ┌────────────────▼──┐     ┌──────────▼───────────┐
              │  webhook/         │     │  ui/                 │
              │  Cloud Run        │     │  Cloud Run           │
              │  MR event → agent │     │  Risk Radar · Graph  │
              │  → posts comment  │     │  Hotspots · Chat     │
              └───────────────────┘     └──────────────────────┘
```

| Layer | Technology |
|---|---|
| Reasoning | **Gemini 2.5 Pro** on **Vertex AI**, orchestrated with **Agent Development Kit (ADK)** |
| Runtime | **Vertex AI Agent Engine** (managed, scalable) |
| Partner integration | **GitLab official MCP server** (`/api/v4/mcp`) — live MR fetch + comment posting |
| Semantic recall | **Vertex AI Vector Search** — embeddings of commits/MRs/issues/decisions |
| Reversion graph | **Firestore** — nodes (commits, MRs, issues, decisions) with reversion + cross-reference edges |
| Surfaces | **Cloud Run** — MR webhook handler + Risk Radar / Graph / Hotspots / Chat UI |
| Secrets | **Secret Manager** — GitLab PAT, webhook secret |
| Observability | **Arize Phoenix** OpenTelemetry tracing |

---

## Scope: what's actually in the index

The agent is built on a **curated, reversion-rich slice** of the upstream repo —
not every commit ever. This is a deliberate trade-off so the demo runs on a
fresh GCP project in under an hour and the memory is high-signal.

| Default cap | Value | Why |
|---|---|---|
| `MAX_COMMITS` | 1,200 | Most recent commits in the window |
| `MAX_MRS` | 500 | Most recently updated merge requests |
| `MAX_ISSUES` | 400 | Most recently updated issues |
| `SINCE_DAYS` | 730 | Two-year window |
| `MR_SEARCH` | `"Revert"` | Targeted pre-pass that **guarantees reverted MRs** land in the slice even when sampling a huge repo |

The `Revert` pre-pass is the key: even on a repo like `gitlab-org/gitlab` (1M+
commits), the slice is guaranteed to contain real reverted decisions with their
review discussion — which is what powers the Risk Radar's reverted-precedent
match. All caps are env-tunable; remove them for a full backfill on smaller
repos.

---

## Repository layout

```
gitlab-oracle/
├── config.py              # Shared config: loads .env + Secret Manager
├── requirements.txt       # Python dependencies
├── Dockerfile             # Container for Cloud Run services
│
├── ingestion/             # One-time backfill: GitLab REST → Firestore + Vector Search
│   ├── main.py            # Orchestrates the full ingestion pipeline
│   ├── embed.py           # Batched text-embedding-005 calls
│   ├── vector_index.py    # Vertex AI Vector Search upserts
│   └── relationships.py   # Mines reversion/decision edges from MR text
│
├── agent/                 # ADK agent: 5 memory tools + GitLab MCP toolset
│   ├── agent.py           # Agent definition and tool registration
│   ├── tools.py           # The 5 memory tools (Firestore + Vector Search)
│   ├── insights.py        # Risk Radar, Knowledge Graph, Hotspots analytics
│   ├── live.py            # Live GitLab REST lookups for exact references
│   ├── prompts.py         # System prompt and response formatting
│   ├── runner.py          # Local runner for dev/testing
│   ├── gitlab_mcp.py      # GitLab MCP client integration
│   ├── store.py           # Firestore read helpers
│   └── observability.py   # Arize Phoenix tracing setup
│
├── webhook/               # Cloud Run: merge_request event → agent → MR comment
│   └── main.py            # FastAPI app, HMAC verification, async dispatch
│
├── ui/                    # Cloud Run: Risk Radar / Graph / Hotspots / Chat
│   ├── main.py            # FastAPI + JSON endpoints
│   └── index.html         # Single-page app (vis-network graph + chat)
│
├── tools/                 # Dev/debug utilities (not deployed)
│   ├── find_revert.py     # Prints reverted MRs in the ingested memory
│   ├── enrich_revert_files.py  # Adds file-level metadata to revert nodes
│   └── backfill_links.py  # Re-mines cross-reference edges in existing data
│
└── deploy/                # Provisioning + deploy scripts
    ├── 01_provision_gcp.sh          # Enable APIs, create GCP resources
    ├── 02_deploy_services.sh        # Deploy webhook + UI to Cloud Run
    ├── 03_deploy_agent_engine.py    # Package + deploy agent to Agent Engine
    └── provision_vector_search.py   # Create + configure Vector Search index
```

---

## Prerequisites

- Python 3.11+
- Google Cloud project with billing enabled
- GitLab account with a PAT (`read_api`, `read_repository`, `api` scope)
- `gcloud` CLI authenticated (`gcloud auth application-default login`)
- `gh` CLI (optional, for GitHub operations)

---

## Local setup

```bash
# 1. Clone and install dependencies
git clone https://github.com/vedant-moxie/gitlab-oracle.git
cd gitlab-oracle
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in your GCP project, GitLab PAT, and the two project paths

# 3. Provision GCP resources (one-time)
bash deploy/01_provision_gcp.sh

# 4. Provision Vertex AI Vector Search index (one-time, takes ~30 min)
./venv/bin/python deploy/provision_vector_search.py
# Copy the printed VECTOR_INDEX_ID and VECTOR_INDEX_ENDPOINT_ID into .env

# 5. Run the ingestion backfill
./venv/bin/python -m ingestion.main

# 6. Run the agent locally
./venv/bin/python -m agent.runner
```

---

## Deployment to Cloud Run

```bash
# Deploy webhook handler + chat UI
bash deploy/02_deploy_services.sh

# Deploy to Vertex AI Agent Engine (optional — for managed, scalable runtime)
./venv/bin/python deploy/03_deploy_agent_engine.py
```

The deploy scripts print the Cloud Run URLs. Add them to your GitLab project's
webhook settings (Settings → Webhooks → Merge request events).

---

## Environment variables

Copy `.env.example` to `.env` and fill in every value. In production, sensitive
values are stored in Secret Manager; the app falls back to env vars for local dev.

| Variable | Description |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | Region (e.g. `us-central1`) |
| `GITLAB_URL` | GitLab instance URL (default: `https://gitlab.com`) |
| `GITLAB_UPSTREAM_PROJECT` | The repo whose history is ingested (e.g. `gitlab-org/gitlab`) |
| `GITLAB_FORK_PROJECT` | Your fork where the live demo MR is opened |
| `GITLAB_PAT` | Personal Access Token — never commit this |
| `VECTOR_INDEX_ID` | Vertex AI Vector Search index resource ID |
| `VECTOR_INDEX_ENDPOINT_ID` | Vector Search endpoint resource ID |
| `VECTOR_DEPLOYED_INDEX_ID` | Deployed index ID (default: `gitlab_oracle_deployed`) |
| `EMBEDDING_MODEL` | Embedding model (default: `text-embedding-005`) |
| `GITLAB_WEBHOOK_SECRET` | HMAC secret for webhook signature verification |
| `MAX_COMMITS` / `MAX_MRS` / `MAX_ISSUES` / `SINCE_DAYS` | Ingestion caps (see Scope above) |

---

## Under the hood: the 5 agent tools

The product surfaces above are built on five plain-function tools the Gemini
agent calls during reasoning. Each returns JSON with `citations` — every claim
is grounded in a specific commit/MR/issue URL.

| Tool | What it does |
|---|---|
| `lookup_reference(reference)` | Resolves a specific commit SHA, `!MR`, or `#issue` to its **live, current** record via GitLab REST — so the agent never infers a change from a branch name |
| `search_decision_history(query, file_path?)` | Semantic search over the reversion-aware index |
| `get_reversion_history(concept_or_file)` | Surfaces approaches that were attempted AND reverted, plus the discussion of why |
| `explain_code_decision(file_path, line_range?)` | Assembles the chronological narrative behind a file's current shape |
| `onboarding_brief(developer_background)` | Returns architectural decisions most likely to surprise a developer from a given background |

Live GitLab operations (reading the current MR, posting comments) go through
the **GitLab MCP server** at `/api/v4/mcp` — the required partner integration.

---

## Observability

Every agent run is traced with [Arize Phoenix](https://phoenix.arize.com/) via
OpenTelemetry. Each tool call, LLM call, and retrieved citation appears as a
span — visible in the Phoenix UI when running locally.

---

## Google Cloud services used

Vertex AI (Gemini 2.5 Pro + text-embedding-005), Agent Development Kit, Vertex
AI Agent Engine, Vertex AI Vector Search, Firestore, Cloud Run, Secret Manager,
Cloud Build.

---

## License

MIT — see [LICENSE](LICENSE).
