from __future__ import annotations
import os
import certifi
os.environ['GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'] = certifi.where()

import os
import certifi
os.environ['GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'] = certifi.where()

"""GitLab Oracle — chat UI (Cloud Run service).

Serves a polished single-page app plus JSON endpoints:
  GET  /            -> the app
  GET  /stats       -> live memory stats (cached) + repo info
  POST /chat        -> ask the Oracle, returns a grounded answer
"""

import time
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import config
from agent.runner import ask

app = FastAPI(title="GitLab Oracle")

_INDEX = (Path(__file__).parent / "index.html").read_text(encoding="utf-8")
_stats_cache: dict = {"at": 0.0, "data": None}
_STATS_TTL = 300


class ChatIn(BaseModel):
    message: str
    project_id: str
    session_id: str | None = None


class RiskIn(BaseModel):
    title: str
    project_id: str
    description: str = ""
    files: list[str] | None = None


@app.get("/healthz")
def healthz():
    return {"ok": True}


def _repo_base(project_id: str) -> str:
    return f"{config.GITLAB_URL.rstrip('/')}/{project_id}"


def _count(db, col: str, project_id: str) -> int:
    from agent.store import project_col

    try:
        res = project_col(db, project_id, col).count().get()
        return int(res[0][0].value)
    except Exception:
        try:
            return sum(1 for _ in project_col(db, project_id, col).select([]).stream())
        except Exception:
            return 0


@app.get("/stats")
def stats(project_id: str = ""):
    project_id = project_id or config.GITLAB_UPSTREAM_PROJECT
    now = time.time()
    cache_key = f"stats:{project_id}"
    if _stats_cache.get(cache_key) and now - _stats_cache[cache_key]["at"] < _STATS_TTL:
        return _stats_cache[cache_key]["data"]
    from google.cloud import firestore

    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    reverted = 0
    try:
        from agent.store import project_col

        reverted = int(
            project_col(db, project_id, config.COL_DECISIONS).where("outcome", "==", "reverted").count().get()[0][0].value
        )
    except Exception:
        pass
    data = {
        "repo": project_id,
        "repo_url": _repo_base(project_id),
        "model": config.AGENT_MODEL,
        "counts": {
            "commits": _count(db, config.COL_COMMITS, project_id),
            "merge_requests": _count(db, config.COL_MRS, project_id),
            "issues": _count(db, config.COL_ISSUES, project_id),
            "decisions": _count(db, config.COL_DECISIONS, project_id),
            "reverts": reverted,
        },
    }
    _stats_cache[cache_key] = {"at": now, "data": data}
    return data


from fastapi import FastAPI, Request, HTTPException

@app.post("/chat")
async def chat(body: ChatIn, request: Request):
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split("Bearer ")[1]
        from agent import context
        context.current_gitlab_token.set(token)
        
    try:
        answer = await ask(body.message, project_id=body.project_id, user_id="ui", session_id=body.session_id)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"The Oracle could not complete this request ({e.__class__.__name__}). Please try again.",
        )
    return {"answer": answer}


class IngestIn(BaseModel):
    project_id: str


def _ingest_status_ref(db, project_id: str):
    from urllib.parse import quote

    return db.collection("ingest_status").document(quote(project_id, safe=""))


def _run_ingest(project_id: str, token: str):
    from google.cloud import firestore

    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    ref = _ingest_status_ref(db, project_id)
    try:
        from ingestion.main import ingest_project

        total = ingest_project(project_id, token)
        ref.set({"state": "done", "nodes": total, "finished_at": time.time()}, merge=True)
        # bust the stats cache so the UI sees fresh counts
        _stats_cache.pop(f"stats:{project_id}", None)
    except Exception as e:
        ref.set({"state": "error", "error": str(e)[:500], "finished_at": time.time()}, merge=True)


@app.post("/ingest")
def ingest(body: IngestIn, request: Request):
    """Kick off a background backfill of a project's memory using the CALLER's
    GitLab token — so they can only ingest repos they can already read."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing GitLab token")
    token = auth_header.split("Bearer ")[1]

    from google.cloud import firestore

    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    ref = _ingest_status_ref(db, body.project_id)
    status = ref.get().to_dict() or {}
    if status.get("state") == "running" and time.time() - status.get("started_at", 0) < 3600:
        return {"state": "running", "note": "ingestion already in progress"}

    ref.set({"state": "running", "started_at": time.time()}, merge=True)
    import threading

    threading.Thread(target=_run_ingest, args=(body.project_id, token), daemon=True).start()
    return {"state": "running"}


@app.get("/ingest/status")
def ingest_status(project_id: str):
    from google.cloud import firestore

    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    return _ingest_status_ref(db, project_id).get().to_dict() or {"state": "none"}


@app.get("/graph")
def graph(project_id: str = ""):
    project_id = project_id or config.GITLAB_UPSTREAM_PROJECT
    from agent.insights import build_graph
    return build_graph(project_id)


@app.get("/hotspots")
def hotspots_endpoint(project_id: str = ""):
    project_id = project_id or config.GITLAB_UPSTREAM_PROJECT
    from agent.insights import hotspots
    return hotspots(project_id)


@app.post("/risk")
def risk(body: RiskIn):
    from agent.insights import score_mr
    return score_mr(body.project_id, body.title, body.description, body.files)


@app.get("/", response_class=HTMLResponse)
def index():
    return _INDEX
