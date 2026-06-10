# DevGenie — Your Repository's Institutional Memory, On Demand

> *AI coding tools see today's code but are blind to its past.*
> DevGenie turns years of commits, merge requests, and review threads into a
> **reversion-aware knowledge graph** any engineer on your team can sign into
> with GitLab and query — and that flags new MRs for high-risk patterns the
> team has already paid for.

Built for the **Google Cloud Rapid Agent Hackathon — GitLab track**.

**Live app (sign in with GitLab):** https://devgenie-app-70965519212.us-central1.run.app
**Live API (FastAPI backend + legacy analytics UI):** https://devgenie-70965519212.us-central1.run.app

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
- *"Explain commit `2391b107` in detail"* → the agent reads the **real patch text** and walks the change line by line.
- *"How is this repo structured?"* → live directory tree + language breakdown + README, straight from GitLab.
- *"I come from Django — what will surprise me here?"* → architectural decisions most likely to trip up that background.

**Every citation is a clickable link** back to the exact commit / MR / issue on
GitLab — a hard system-prompt rule, with fabricated URLs forbidden. Attach code
files to a message (📎, up to 5) to give the agent direct context, and your
conversation history persists across sessions.

### 📚 Multi-repository, multi-tenant
Pick **any project your GitLab account can read** from the sidebar and click
**✨ Ingest this repository** — a parallel backfill (issues / MRs / commits run
concurrently, diff & notes fetches fan out across 8 workers) builds that repo's
memory in minutes, isolated per-project in Firestore
(`projects/<encoded-id>/…`) and in Vector Search via `project_id` restrictions.
Access control is the user's own OAuth token: you can only ingest and query
what you can already read on GitLab, and tokens auto-refresh (GitLab expires
them after ~2h) with a visible re-auth banner if rotation ever fails.

### 🛡️ Honest by design — degraded ≠ hallucinated
The agent classifies each question and routes it to the right tool instead of
blind semantic search. If data is missing it says so; if the project is a fork
of a big upstream it tells you whose history you're reading. When Vector
Search is unreachable, a stale-gRPC self-heal (reset + retry) kicks in first,
then a **Firestore keyword fallback** — and fallback answers are explicitly
labeled as lexical, never passed off as semantic recall.

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
                  │  9 memory tools (_safe_tool wrapped)     │
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
| Frontend | **Next.js 16** + **NextAuth** (GitLab OAuth, refresh-token rotation) — Cloud Run service `devgenie-app` |
| Reasoning | **Gemini 2.5 Pro** on **Vertex AI**, orchestrated with **Agent Development Kit (ADK)** — benchmarked against `gemini-3-flash-preview` on real institutional-memory queries (3 fully-cited revert chains vs 1) |
| Model flexibility | `AGENT_MODEL` env switch; non-Gemini Model Garden models (Claude, Llama, …) route automatically via **LiteLLM** — swapping models is zero code changes |
| Runtime | **Vertex AI Agent Engine** (managed, scalable) |
| Partner integration | **GitLab official MCP server** (`/api/v4/mcp`) — used live in every MR review for the current diff |
| Semantic recall | **Vertex AI Vector Search** with project-scoped restrictions + stale-gRPC self-healing + Firestore keyword fallback |
| Reversion graph | **Firestore**, project-scoped under `projects/<encoded-id>/` |
| Surfaces | **Cloud Run** — `devgenie-app` (Next.js), `devgenie` (FastAPI backend + legacy SPA), `gitlab-oracle-webhook` (MR auto-review) |
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
├── frontend/              # Next.js SaaS — sign in with GitLab (Cloud Run: devgenie-app)
│   ├── Dockerfile                 # Multi-stage build; secrets injected at deploy
│   ├── src/app/page.tsx           # Landing page (genie mascot, dark dev theme)
│   ├── src/app/chat/page.tsx      # Chat UI: multi-repo picker, ingest button,
│   │                              #   file attachments, conversation history
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

## The 9 agent tools

The agent reasons by calling these — each returns JSON with grounded
`citations` (web URLs the prompt **requires** it to render as links), and each
is wrapped in `_safe_tool` so a Vector Search outage degrades gracefully
instead of crashing the run. The system prompt routes by question type
(structural → live tree; "explain this commit" → real diff; time-bounded →
recent activity; …) instead of blind semantic search.

| Tool | What it does |
|---|---|
| `lookup_reference(reference)` | Resolves a specific commit SHA / `!MR` / `#issue` to its **live** GitLab record |
| `get_commit_diff(reference)` | Fetches the **real patch text** of a commit so the agent can explain a change line by line |
| `search_decision_history(query, file_path?)` | Semantic search over the reversion-aware index (keyword fallback when degraded, disclosed) |
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
#    Redirect URI: http://localhost:3737/api/auth/callback/gitlab
#    Scopes: read_api read_user
cat > frontend/.env.local <<EOF
GITLAB_CLIENT_ID=<client id>
GITLAB_CLIENT_SECRET=<client secret>
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3737
BACKEND_URL=http://127.0.0.1:8001
EOF

# 6. Run (three terminals)
# T1 — FastAPI backend
./venv/bin/uvicorn ui.main:app --reload --port 8001

# T2 — Next.js frontend
cd frontend && npm run dev   # → http://localhost:3737

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

# Deploy webhook + backend to Cloud Run
bash deploy/02_deploy_services.sh

# Deploy the agent to Vertex AI Agent Engine (managed runtime, optional)
./venv/bin/python deploy/03_deploy_agent_engine.py

# Deploy the Next.js frontend to Cloud Run (uses frontend/Dockerfile;
# secrets injected at deploy time, never baked into the image)
cd frontend
gcloud run deploy devgenie-app --source . --region us-central1 \
  --allow-unauthenticated --memory 512Mi \
  --set-env-vars "GITLAB_CLIENT_ID=...,GITLAB_CLIENT_SECRET=...,NEXTAUTH_SECRET=$(openssl rand -base64 32),NEXTAUTH_URL=https://<service-url>,BACKEND_URL=https://<backend-url>"
```

> ⚠️ After the first frontend deploy, add the production callback
> `https://<frontend-url>/api/auth/callback/gitlab` to your GitLab OAuth app's
> Redirect URIs (https://gitlab.com/-/user_settings/applications), or sign-in
> will fail with a redirect mismatch.

A root `.gcloudignore` keeps backend source uploads at ~4.5MB (without it,
`gcloud run deploy --source .` ships `frontend/node_modules` — 559MB — because
gcloud only honors the repo-root ignore file).

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
| `AGENT_MODEL` | Reasoning model (default `gemini-2.5-pro`). Any Vertex Model Garden model works — non-Gemini IDs (e.g. `claude-sonnet-4-5@20250929`) route via LiteLLM automatically |
| `GOOGLE_GENAI_USE_VERTEXAI` | Must be `TRUE` on Cloud Run so the genai client uses Vertex instead of API-key mode |
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
span — visible in the Phoenix UI when running locally. On Cloud Run we also
fan the same spans out to **Google Cloud Trace** (enable with
`ENABLE_CLOUD_TRACE=1`) so judges can inspect live reasoning traces directly
from the GCP console.

---

## Google Cloud services used

Vertex AI (Gemini 2.5 Pro + text-embedding-005), Agent Development Kit, Vertex
AI Agent Engine, Vertex AI Vector Search, Firestore, Cloud Run, Secret Manager,
Cloud Build.

---

## License

MIT — see [LICENSE](LICENSE).
