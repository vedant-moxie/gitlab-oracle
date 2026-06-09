"""GitLab Oracle — chat UI (Cloud Run service).

Serves a polished single-page app plus JSON endpoints:
  GET  /            -> the app
  GET  /stats       -> live memory stats (cached) + repo info
  POST /chat        -> ask the Oracle, returns a grounded answer
"""
from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI
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
    try:
        res = db.collection("projects").document(project_id).collection(col).count().get()
        return int(res[0][0].value)
    except Exception:
        try:
            return sum(1 for _ in db.collection("projects").document(project_id).collection(col).select([]).stream())
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
        reverted = int(
            db.collection("projects").document(project_id).collection(config.COL_DECISIONS).where("outcome", "==", "reverted").count().get()[0][0].value
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


@app.post("/chat")
async def chat(body: ChatIn):
    answer = await ask(body.message, project_id=body.project_id, user_id="ui", session_id=body.session_id)
    return {"answer": answer}


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
