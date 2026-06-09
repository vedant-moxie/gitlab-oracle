"""Shared configuration for GitLab Oracle.

Loads from environment variables (and a local .env for dev). In production
(Cloud Run / Agent Engine) secrets come from Secret Manager, not .env.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Tiny .env loader (avoids adding python-dotenv as a dependency)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(Path(__file__).parent / ".env")


@lru_cache(maxsize=None)
def get_secret(secret_id: str) -> str:
    """Fetch a secret from Secret Manager; falls back to an env var of the
    same upper-cased name for local development."""
    env_fallback = os.environ.get(secret_id.upper().replace("-", "_"))
    try:
        from google.cloud import secretmanager

        client = secretmanager.SecretManagerServiceClient()
        project = PROJECT_ID
        name = f"projects/{project}/secrets/{secret_id}/versions/latest"
        resp = client.access_secret_version(request={"name": name})
        return resp.payload.data.decode("utf-8")
    except Exception:
        if env_fallback:
            return env_fallback
        raise


# ---- Google Cloud ----
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "autodev-agent")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

# ---- GitLab ----
GITLAB_URL = os.environ.get("GITLAB_URL", "https://gitlab.com")
GITLAB_UPSTREAM_PROJECT = os.environ.get("GITLAB_UPSTREAM_PROJECT", "")
GITLAB_FORK_PROJECT = os.environ.get("GITLAB_FORK_PROJECT", "")

# ---- Vertex AI Vector Search ----
VECTOR_INDEX_ID = os.environ.get("VECTOR_INDEX_ID", "")
VECTOR_INDEX_ENDPOINT_ID = os.environ.get("VECTOR_INDEX_ENDPOINT_ID", "")
VECTOR_DEPLOYED_INDEX_ID = os.environ.get("VECTOR_DEPLOYED_INDEX_ID", "gitlab_oracle_deployed")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-005")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))

# ---- Firestore ----
FIRESTORE_DATABASE = os.environ.get("FIRESTORE_DATABASE", "(default)")

# ---- Agent / GitLab MCP ----
AGENT_MODEL = os.environ.get("AGENT_MODEL", "gemini-2.5-pro")
# GitLab's native MCP endpoint (GitLab 18+). For self-managed swap the host.
# Alternatively run a stdio MCP server via npx and set GITLAB_MCP_STDIO=1.
GITLAB_MCP_URL = os.environ.get("GITLAB_MCP_URL", f"{GITLAB_URL}/api/v4/mcp")
GITLAB_MCP_STDIO = os.environ.get("GITLAB_MCP_STDIO", "0") == "1"

# ---- External Notifications ----
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")

# Firestore collection names
COL_COMMITS = "commits"
COL_MRS = "merge_requests"
COL_ISSUES = "issues"
COL_DECISIONS = "decisions"
