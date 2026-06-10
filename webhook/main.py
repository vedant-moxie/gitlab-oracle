from __future__ import annotations
import os
import certifi
os.environ['GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'] = certifi.where()
"""GitLab Oracle — merge-request webhook (Cloud Run service).

GitLab fires a `Merge Request Hook` here on MR open/update/merge.
1. On open/update: We run the Oracle over the MR, and if it finds relevant
   institutional memory, post it back as an MR comment and optionally to Slack.
2. On merge: We trigger incremental ingestion so the memory graph stays current.
"""

import hmac
import json
import os
from urllib import request as urlrequest

import gitlab
from fastapi import FastAPI, Header, HTTPException, Request

import config
from agent.prompts import MR_REVIEW_TEMPLATE
from agent.runner import ask
from ingestion.main import ingest_mrs

app = FastAPI(title="GitLab Oracle Webhook")

_WEBHOOK_SECRET = os.environ.get("GITLAB_WEBHOOK_SECRET", "")
_NO_CONTEXT = "NO_HISTORICAL_CONTEXT"

def _gl():
    return gitlab.Gitlab(url=config.GITLAB_URL, private_token=config.get_secret("gitlab-pat"))

def _notify_slack(text: str, mr_url: str, title: str):
    """Post an alert to Slack if configured."""
    if not config.SLACK_WEBHOOK_URL:
        return
    payload = {
        "text": f"🧠 *GitLab Oracle Alert* for <{mr_url}|{title}>\n{text}"
    }
    req = urlrequest.Request(
        config.SLACK_WEBHOOK_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        urlrequest.urlopen(req, timeout=5)
    except Exception as e:
        print(f"Slack notification failed: {e}")

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.post("/webhook")
async def webhook(request: Request, x_gitlab_token: str = Header(default="")):
    if _WEBHOOK_SECRET and not hmac.compare_digest(x_gitlab_token, _WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="bad webhook token")

    payload = await request.json()
    if payload.get("object_kind") != "merge_request":
        return {"skipped": "not a merge_request event"}

    attrs = payload.get("object_attributes", {})
    action = attrs.get("action")

    # ---- Continuous Ingestion on Merge ----
    if action == "merge":
        # Incremental ingestion: pull only the few most-recently-touched MRs.
        # We pass overrides directly to ingest_mrs because MAX_MRS / MR_SEARCH
        # in ingestion/main.py are module-level constants read at import time —
        # mutating os.environ here would have no effect.
        try:
            from google.cloud import firestore
            db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
            project_id_str = str(payload["project"]["id"])
            project = _gl().projects.get(project_id_str)
            n = ingest_mrs(project_id_str, project, db, max_mrs=10, mr_search="")
            return {"ingested": True, "mrs_processed": n, "mr": attrs["iid"]}
        except Exception as e:
            return {"error": f"ingestion failed: {e}"}

    # ---- Review on Open/Update ----
    if action not in ("open", "reopen", "update"):
        return {"skipped": f"action={action}"}

    project_id = str(payload["project"]["id"])
    mr_iid = attrs["iid"]

    prompt = MR_REVIEW_TEMPLATE.format(
        iid=mr_iid,
        title=attrs.get("title", ""),
        source_branch=attrs.get("source_branch", ""),
        target_branch=attrs.get("target_branch", ""),
        description=attrs.get("description", "") or "(no description)",
    )
    review = await ask(prompt, project_id=project_id, user_id="webhook", session_id=f"mr-{project_id}-{mr_iid}")

    if not review or _NO_CONTEXT in review:
        return {"mr": mr_iid, "posted": False, "reason": "no relevant history"}

    gl = _gl()
    project = gl.projects.get(project_id)
    mr = project.mergerequests.get(mr_iid)

    # Lead the comment with an explainable risk badge derived from score_mr().
    # Defensive: a failing risk score must NEVER block the agent's review from
    # being posted — Vector Search outages, Firestore degradation, etc. fall
    # through to a header-less comment.
    header = ""
    risk_meta: dict = {}
    try:
        files: list[str] = []
        try:
            changes = mr.changes()
            files = [c.get("new_path") for c in (changes.get("changes") or []) if c.get("new_path")]
        except Exception:
            pass
        from agent.insights import score_mr

        risk = score_mr(
            project_id,
            attrs.get("title", ""),
            attrs.get("description", "") or "",
            files,
        )
        emoji = {"LOW": "🟢", "MEDIUM": "🟡", "HIGH": "🔴"}.get(risk["level"], "🧠")
        top_reason = (risk["reasons"][0]["text"] if risk.get("reasons") else "").strip()
        header = (
            f"**{emoji} Risk: {risk['level']} ({risk['score']}/100)** — {top_reason}\n\n"
            f"---\n\n"
        )
        risk_meta = {"level": risk["level"], "score": risk["score"]}
    except Exception as e:
        print(f"   (risk header skipped: {e})")

    body = f"### 🧠 DevGenie — Institutional Memory\n\n{header}{review}"
    mr.notes.create({"body": body})

    _notify_slack(f"{header}{review}", mr.web_url, attrs.get("title", ""))

    return {"mr": mr_iid, "posted": True, **({"risk": risk_meta} if risk_meta else {})}
