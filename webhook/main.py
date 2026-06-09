"""GitLab Oracle — merge-request webhook (Cloud Run service).

GitLab fires a `Merge Request Hook` here on MR open/update/merge.
1. On open/update: We run the Oracle over the MR, and if it finds relevant
   institutional memory, post it back as an MR comment and optionally to Slack.
2. On merge: We trigger incremental ingestion so the memory graph stays current.
"""
from __future__ import annotations

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
        # Hacky incremental ingestion: just run the recent-MR pass again.
        # In a real system, we'd queue an async task. Here we do it inline.
        try:
            from google.cloud import firestore
            db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
            project_id_str = str(payload["project"]["id"])
            project = _gl().projects.get(project_id_str)
            # Temporarily disable the Revert search pass to just get recent MRs
            os.environ["MR_SEARCH"] = ""
            os.environ["MAX_MRS"] = "10" # only fetch a few recent
            ingest_mrs(project_id_str, project, db)
            return {"ingested": True, "mr": attrs["iid"]}
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

    body = f"### 🧠 GitLab Oracle — Institutional Memory\n\n{review}"
    gl = _gl()
    project = gl.projects.get(project_id)
    mr = project.mergerequests.get(mr_iid)
    mr.notes.create({"body": body})

    _notify_slack(review, mr.web_url, attrs.get("title", ""))

    return {"mr": mr_iid, "posted": True}
