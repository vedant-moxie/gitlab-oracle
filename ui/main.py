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
    session_id: str | None = None


class RiskIn(BaseModel):
    title: str
    description: str = ""
    files: list[str] | None = None


@app.get("/healthz")
def healthz():
    return {"ok": True}


def _repo_base() -> str:
    return f"{config.GITLAB_URL.rstrip('/')}/{config.GITLAB_UPSTREAM_PROJECT}"


def _count(db, col: str) -> int:
    try:
        res = db.collection(col).count().get()
        return int(res[0][0].value)
    except Exception:
        try:
            return sum(1 for _ in db.collection(col).select([]).stream())
        except Exception:
            return 0


@app.get("/stats")
def stats():
    now = time.time()
    if _stats_cache["data"] and now - _stats_cache["at"] < _STATS_TTL:
        return _stats_cache["data"]
    from google.cloud import firestore

    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    reverted = 0
    try:
        reverted = int(
            db.collection(config.COL_DECISIONS).where("outcome", "==", "reverted").count().get()[0][0].value
        )
    except Exception:
        pass
    data = {
        "repo": config.GITLAB_UPSTREAM_PROJECT,
        "repo_url": _repo_base(),
        "model": config.AGENT_MODEL,
        "counts": {
            "commits": _count(db, config.COL_COMMITS),
            "merge_requests": _count(db, config.COL_MRS),
            "issues": _count(db, config.COL_ISSUES),
            "decisions": _count(db, config.COL_DECISIONS),
            "reverts": reverted,
        },
    }
    _stats_cache.update(at=now, data=data)
    return data


@app.post("/chat")
async def chat(body: ChatIn):
    answer = await ask(body.message, user_id="ui", session_id=body.session_id)
    return {"answer": answer}


@app.get("/graph")
def graph():
    from agent.insights import build_graph
    return build_graph()


@app.get("/hotspots")
def hotspots_endpoint():
    from agent.insights import hotspots
    return hotspots()


@app.post("/risk")
def risk(body: RiskIn):
    from agent.insights import score_mr
    return score_mr(body.title, body.description, body.files)


@app.get("/", response_class=HTMLResponse)
def index():
    return _INDEX
