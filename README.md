# GitLab Oracle — Institutional Memory Agent

> *Current AI coding tools are stateless: they see today's code but are blind to its entire past.*
> GitLab Oracle ingests a repository's **full history** — every commit, merge request, review
> thread, and issue resolution — into a temporal knowledge graph, then reasons over it with
> **Gemini** so the team never re-learns a lesson it already paid for.

Built for the **Google Cloud Rapid Agent Hackathon — GitLab track**.

**Live UI:** https://gitlab-oracle-ui-4delfm4yta-uc.a.run.app

---

## What it does

| Capability | Example |
|---|---|
| **Catch repeat mistakes on new MRs** | Webhook fires on every new MR; Oracle surfaces prior attempts at the same approach and why they were reverted — *"This pattern was tried in !847 and reverted after a payment-queue race condition."* |
| **Explain why code exists** | *"Why is the payment service built this way?"* → narrative traced through commits, MRs, and the incident issue that drove the design, with clickable citations. |
| **Onboard new engineers** | *"I come from Django — what will surprise me here?"* → architectural decisions most likely to trip up that background. |

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
                    │  Knowledge     │  │  Vertex AI            │
                    │  Graph         │  │  Vector Search        │
                    │  (nodes+edges) │  │  (semantic recall)    │
                    └─────────────┬──┘  └───┬──────────────────┘
                                  │          │
                    ┌─────────────▼──────────▼──────────────────┐
                    │            agent/  (ADK + Gemini 2.5 Pro) │
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
              │  MR event → agent │     │  Chat interface      │
              │  → posts comment  │     │  with citations      │
              └───────────────────┘     └──────────────────────┘
```

| Layer | Technology |
|---|---|
| Reasoning | **Gemini 2.5 Pro** on **Vertex AI**, orchestrated with **Agent Development Kit (ADK)** |
| Runtime | **Vertex AI Agent Engine** (managed, scalable) |
| Partner integration | **GitLab official MCP server** (`/api/v4/mcp`) — live MR fetch + comment posting |
| Semantic recall | **Vertex AI Vector Search** — embeddings of commits/MRs/issues/decisions |
| Temporal graph | **Firestore** — nodes (commits, MRs, issues, decisions) + reversion/decision edges |
| Surfaces | **Cloud Run** — MR webhook handler + chat UI |
| Secrets | **Secret Manager** — GitLab PAT, webhook secret |
| Observability | **Arize Phoenix** OpenTelemetry tracing |

---

## Repository layout

```
gitlabs_cloud/
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
├── agent/                 # ADK agent: 4 memory tools + GitLab MCP toolset
│   ├── agent.py           # Agent definition and tool registration
│   ├── tools.py           # The 4 memory tools (Firestore + Vector Search)
│   ├── prompts.py         # System prompt and response formatting
│   ├── runner.py          # Local runner for dev/testing
│   ├── gitlab_mcp.py      # GitLab MCP client integration
│   ├── insights.py        # Analytics helpers
│   ├── live.py            # Live GitLab event processing
│   ├── store.py           # Firestore read helpers
│   └── observability.py   # Arize Phoenix tracing setup
│
├── webhook/               # Cloud Run: merge_request event → agent → MR comment
│   └── main.py            # FastAPI app, HMAC verification, async dispatch
│
├── ui/                    # Cloud Run: chat UI with source citations
│   ├── main.py            # FastAPI + streaming SSE responses
│   └── index.html         # Single-page chat interface
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

The deploy scripts print the Cloud Run URLs. Add them to your GitLab project's webhook settings (Settings → Webhooks → Merge request events).

---

## Environment variables

Copy `.env.example` to `.env` and fill in every value. In production, sensitive values are stored in Secret Manager; the app falls back to env vars for local dev.

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

---

## The 4 agent tools

| Tool | What it does |
|---|---|
| `search_decision_history(query, file_path?)` | Semantic search over decisions, commits, and MRs |
| `get_reversion_history(concept_or_file)` | Surfaces reverted work and the discussion of why |
| `explain_code_decision(file_path, line_range?)` | Assembles the narrative behind a specific code region |
| `onboarding_brief(developer_background)` | Returns surprising architectural decisions for a newcomer |

Live GitLab operations (read the current MR, post a comment) go through the **GitLab MCP server** at `/api/v4/mcp`.

---

## Observability

Every agent run is traced with [Arize Phoenix](https://phoenix.arize.com/) via OpenTelemetry. Each tool call, LLM call, and retrieved citation appears as a span — visible in the Phoenix UI when running locally.

---

## Google Cloud services used

Vertex AI (Gemini 2.5 Pro + text-embedding-005), Agent Development Kit, Vertex AI Agent Engine, Vertex AI Vector Search, Firestore, Cloud Run, Secret Manager, Cloud Build.

---

## License

MIT — see [LICENSE](LICENSE).
