# DevGenie — Your Repository's Institutional Memory, On Demand

> *AI coding tools see today's code but are blind to its past.*
> DevGenie turns years of commits, merge requests, and review threads into a
> **reversion-aware knowledge graph** any engineer on your team can sign into
> with GitLab and query — and that flags new MRs for high-risk patterns the
> team has already paid for.

Built for the **Google Cloud Rapid Agent Hackathon — GitLab track**.

**Live (legacy single-tenant UI):** https://gitlab-oracle-ui-4delfm4yta-uc.a.run.app
**Live (new SaaS):** *fill in Vercel/Cloud-Run URL before submission*

---

## What it does

### 🎯 Risk Radar — score any MR against the team's memory
Paste an MR title, description, and touched files. Get a **0–100 risk score**
and the *reasons* behind it — each one a clickable citation back to the commit,
MR, or issue that drove it.

> **🔴 Risk: HIGH (78/100)** — Closely matches a previously **REVERTED**
> approach: !237909 *"Use Sidekiq for inline auth checks."*
> Touches `app/services/auth/login.rb` — 3 prior reverts here. One author owns
> this file (bus factor 1).

Wired into the chat surface as a one-click quick-action. Powered by `POST /risk`
(`agent/insights.py`). Combines nearest-neighbor reversion lookup, file hotspot
weighting, and bus-factor analysis. Every reason is explained — no black box.

### 🤖 Webhook auto-review — runs without anyone asking
GitLab fires the webhook on every new MR → DevGenie fetches the *live diff* via
the **GitLab MCP server**, looks up reverted precedents, computes a risk score,
and posts a comment on the MR led by an explainable **risk badge**:

> ### 🧠 DevGenie — Institutional Memory
>
> **🔴 Risk: HIGH (78/100)** — Closely matches a previously REVERTED approach...
>
> ---
>
> [agent's grounded review with [live via MCP] citations and historical references]

On merge, the same webhook triggers an incremental re-ingestion so the memory
stays current.

### 💬 Grounded chat — ask "why", not just "what"
Sign in with GitLab. Pick any repo you can read. Ask:

- *"Why is the payment path built this way?"* → narrative through commits, MR, and the incident issue that drove it, every claim a clickable citation.
- *"Who wrote line 142 of `auth/session.rb` and why?"* → live blame → commit → linked MR → discussion.
- *"What changes have been tried and reverted?"* → reversion graph hops.
- *"I come from Django — what will surprise me here?"* → architectural decisions most likely to trip up that background.

### 🔥 Hotspots & Bus-Factor — where institutional risk concentrates
File-level ranking by `churn × revert weight × decision density`, lockfile and
generated-file noise filtered out. Flags single-owner files with high churn —
the *"if Alice leaves, we're stuck"* list. Powered by `GET /hotspots`.

### 🕸️ Knowledge Graph — reversion edges, in red
Interactive force-directed view of the repo's decisions and their reversion
edges. Powered by `GET /graph`.

### 🔔 Slack notifications
Hit `SLACK_WEBHOOK_URL` in your `.env` and every auto-posted MR comment also
lands in your Slack channel.

---

## Architecture

```
                  ┌──────────────────────────────────────────┐
                  │  frontend/  Next.js + NextAuth (GitLab)  │
                  │  Landing · /chat · Risk Radar modal      │
                  └──────────────────┬───────────────────────┘
                                     │ Bearer: user's GitLab OAuth token
                                     ▼
                  ┌──────────────────────────────────────────┐
                  │  FastAPI backend (ui/main.py)            │
                  │  /chat /ingest /risk /graph /hotspots ...│
                  │  contextvars(project_id, gitlab_token)   │
                  └──────────────────┬───────────────────────┘
                                     ▼
                  ┌──────────────────────────────────────────┐
                  │  agent/   ADK + Gemini 2.5 Pro (temp=0)  │
                  │  8 memory tools (_safe_tool wrapped)     │
                  │  + GitLab MCP toolset (live MR / blame)  │
                  └──────────────────┬───────────────────────┘
                                     ▼
            ┌──────────────────┐         ┌────────────────────────┐
            │  Firestore       │         │  Vertex AI Vector      │
            │  projects/<id>/  │         │  Search (multi-tenant  │
            │  commits, MRs,   │         │  via type+project_id   │
            │  issues,         │         │  restrictions)         │
            │  decisions       │         └────────────────────────┘
            └──────────────────┘

                  ┌──────────────────────────────────────────┐
                  │  webhook/  Cloud Run                     │
                  │  MR event → agent → MR comment w/ risk   │
                  │  badge + [live via MCP] file citation    │
                  │  Slack notification (optional)           │
                  │  On merge → incremental re-ingest        │
                  └──────────────────────────────────────────┘
```

| Layer | Technology |
|---|---|
| Frontend | **Next.js 16** + **NextAuth** (GitLab OAuth, refresh-token rotation) |
| Reasoning | **Gemini 2.5 Pro** on **Vertex AI**, orchestrated with **Agent Development Kit (ADK)** |
| Runtime | **Vertex AI Agent Engine** (managed, scalable) |
| Partner integration | **GitLab official MCP server** (`/api/v4/mcp`) — used live in every MR review for the current diff |
| Semantic recall | **Vertex AI Vector Search** with project-scoped restrictions |
| Reversion graph | **Firestore**, project-scoped under `projects/<encoded-id>/` |
| Surfaces | **Cloud Run** — webhook + FastAPI backend + (legacy) analytics SPA |
| Secrets | **Secret Manager** — GitLab PAT, webhook secret |
| Observability | **Arize Phoenix** OpenTelemetry tracing |

---

## Scope: what's actually in the index

DevGenie ingests a **curated, reversion-rich slice** of each project — not every
commit ever — so the demo runs on a fresh GCP project in under an hour and the
memory stays high-signal.

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

Ingestion runs three phases (issues / MRs / commits) **concurrently** via
`ThreadPoolExecutor`, and inside each phase the diff and notes fetches are
parallelized with 8 workers — a backfill of `gitlab-org/gitlab` finishes in
minutes, not hours.

---

## Repository layout

```
devgenie/
├── config.py              # Shared config: loads .env + Secret Manager
├── requirements.txt       # Python dependencies
├── Dockerfile             # Container for Cloud Run services
│
├── frontend/              # NEW: Next.js SaaS — sign in with GitLab
│   ├── src/app/page.tsx           # Landing page
│   ├── src/app/chat/page.tsx      # Chat UI + Risk Radar entry point
│   ├── src/app/api/
│   │   ├── auth/[...nextauth]/    # GitLab OAuth with refresh-token rotation
│   │   ├── chat/  ingest/  stats/  projects/  risk/   # backend proxies
│   └── src/components/
│       ├── RiskRadarModal.tsx     # 0–100 score with explainable reasons
│       ├── Brand.tsx · Genie.tsx · Markdown.tsx
│
├── ingestion/             # Parallel backfill: GitLab REST → Firestore + Vector Search
│   ├── main.py            # ingest_project() — concurrent issues/MRs/commits phases
│   ├── embed.py           # text-embedding-005 with parallel sub-batches
│   ├── vector_index.py    # Vertex AI Vector Search upsert + project-scoped filter
│   └── relationships.py   # Mines reversion + cross-reference edges from MR text
│
├── agent/                 # ADK agent: 8 memory tools + GitLab MCP toolset
│   ├── agent.py           # Agent definition (Gemini 2.5 Pro, temperature=0)
│   ├── tools.py           # 8 memory tools, each wrapped with _safe_tool
│   ├── context.py         # contextvars: per-request project_id + gitlab_token
│   ├── insights.py        # Risk Radar (score_mr), Knowledge Graph, Hotspots
│   ├── live.py            # Live GitLab REST: lookup_reference, blame, repo_structure
│   ├── prompts.py         # System prompt + MR_REVIEW_TEMPLATE (LIVE-FETCH-first)
│   ├── runner.py          # ADK runner (per-conversation sessions)
│   ├── gitlab_mcp.py      # GitLab MCP client integration
│   ├── store.py           # Project-scoped Firestore retrieval + graph hops
│   └── observability.py   # Arize Phoenix tracing setup
│
├── webhook/               # Cloud Run: MR event → agent → risk-badged comment
│   └── main.py            # FastAPI app, HMAC verification, incremental ingest on merge
│
├── ui/                    # Legacy single-tenant SPA (Risk Radar / Graph / Hotspots)
│   ├── main.py            # FastAPI backend — serves both the legacy UI and the SaaS proxy
│   └── index.html         # Single-page chat + vis-network graph
│
├── tools/                 # Dev/debug utilities (not deployed)
└── deploy/                # Provisioning + Cloud Run deploy scripts
```

---

## The 8 agent tools

The agent reasons by calling these — each returns JSON with grounded
`citations`, and each is wrapped in `_safe_tool` so a Vector Search outage
degrades gracefully instead of crashing the run.

| Tool | What it does |
|---|---|
| `lookup_reference(reference)` | Resolves a specific commit SHA / `!MR` / `#issue` to its **live** GitLab record |
| `search_decision_history(query, file_path?)` | Semantic search over the reversion-aware index |
| `get_reversion_history(concept_or_file)` | Surfaces approaches that were attempted AND reverted, plus why |
| `explain_code_decision(file_path, line_range?)` | Chronological narrative behind a file's current shape |
| `onboarding_brief(developer_background)` | Decisions most likely to surprise a developer from a given background |
| `explain_blame(file_path, line_number)` | Live `git blame` → commit → linked MR for one specific line |
| `get_recent_activity(days)` | Time-bounded digest (newest commits / MRs / issues) |
| `get_repository_structure(path?)` | Live directory tree + language breakdown + README excerpt |

Live GitLab operations (current MR diff, posting comments) go through the
**GitLab MCP server** at `/api/v4/mcp` — the required partner integration. The
webhook's `MR_REVIEW_TEMPLATE` mandates a LIVE-FETCH-via-MCP step before any
history search, and every posted comment cites at least one MCP-sourced file
with `[live via MCP]` so reviewers can see live data was used.

---

## Prerequisites

- Python 3.11+
- Node.js 20+ (for the frontend)
- Google Cloud project with billing enabled
- GitLab account
- `gcloud` CLI authenticated (`gcloud auth application-default login`)

---

## Local development

```bash
# 1. Backend deps
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt

# 2. Frontend deps
cd frontend && npm install && cd ..

# 3. GCP auth so Vertex AI / Firestore calls work locally
gcloud auth application-default login

# 4. Backend env
cp .env.example .env
# Fill in: GOOGLE_CLOUD_PROJECT, VECTOR_INDEX_ID, VECTOR_INDEX_ENDPOINT_ID,
# GITLAB_PAT, GITLAB_UPSTREAM_PROJECT, GITLAB_FORK_PROJECT, GITLAB_WEBHOOK_SECRET

# 5. Frontend env (frontend/.env.local) — GitLab OAuth app credentials
#    Create the OAuth app at https://gitlab.com/-/user_settings/applications
#    Redirect URI: http://localhost:3000/api/auth/callback/gitlab
#    Scopes: read_api read_user
cat > frontend/.env.local <<EOF
GITLAB_CLIENT_ID=<client id>
GITLAB_CLIENT_SECRET=<client secret>
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000
BACKEND_URL=http://127.0.0.1:8001
EOF

# 6. Run (three terminals)
# T1 — FastAPI backend
./venv/bin/uvicorn ui.main:app --reload --port 8001

# T2 — Next.js frontend
cd frontend && npm run dev   # → http://localhost:3000

# T3 — Webhook (only for the MR auto-comment flow)
./venv/bin/uvicorn webhook.main:app --reload --port 8002
```

To ingest a project's history: in `/chat` after signing in, pick the project
and click **"Ingest this repository"** in the sidebar. Or from the CLI:

```bash
./venv/bin/python -m ingestion.main   # uses GITLAB_UPSTREAM_PROJECT from .env
```

---

## Deployment

```bash
# Provision GCP resources (one-time)
bash deploy/01_provision_gcp.sh

# Provision Vertex AI Vector Search index (one-time, ~30 min)
./venv/bin/python deploy/provision_vector_search.py

# Deploy webhook + UI to Cloud Run
bash deploy/02_deploy_services.sh

# Deploy the agent to Vertex AI Agent Engine (managed runtime, optional)
./venv/bin/python deploy/03_deploy_agent_engine.py

# Deploy the Next.js frontend to Vercel (or your platform of choice)
cd frontend && vercel
```

Add the webhook URL to your GitLab project's webhook settings (Settings →
Webhooks → Merge request events, Merge events).

---

## Environment variables

Sensitive values live in **Secret Manager** in production; `.env` is local-dev
only.

| Variable | Description |
|---|---|
| `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | GCP project + region |
| `GITLAB_URL` | GitLab instance (default `https://gitlab.com`) |
| `GITLAB_UPSTREAM_PROJECT` | Default project for the legacy single-tenant UI |
| `GITLAB_FORK_PROJECT` | Your fork where demo MRs are opened |
| `GITLAB_PAT` | Personal Access Token — Secret Manager `gitlab-pat` |
| `VECTOR_INDEX_ID` / `VECTOR_INDEX_ENDPOINT_ID` / `VECTOR_DEPLOYED_INDEX_ID` | Vertex AI Vector Search resource IDs |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | `text-embedding-005` / 768 by default |
| `GITLAB_WEBHOOK_SECRET` | HMAC for the webhook's signature check |
| `SLACK_WEBHOOK_URL` | Optional — post MR warnings to Slack |
| `MAX_COMMITS` / `MAX_MRS` / `MAX_ISSUES` / `SINCE_DAYS` | Ingestion caps (see *Scope* above) |
| **Frontend** | |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` | GitLab OAuth app credentials |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | NextAuth session signing + base URL |
| `BACKEND_URL` | FastAPI backend (default `http://127.0.0.1:8001`) |

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
