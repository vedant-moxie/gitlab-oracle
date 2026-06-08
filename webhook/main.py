"""GitLab Oracle — merge-request webhook (Cloud Run service).

GitLab fires a `Merge Request Hook` here on MR open/update. We run the Oracle
over the MR, and if it finds relevant institutional memory, post it back as an
MR comment. This is the demo money-shot: the agent catches a re-attempt of a
previously-reverted approach automatically.

Comment posting uses python-gitlab (deterministic). The agent itself also has
the GitLab MCP toolset for live reads during reasoning.
"""
from __future__ import annotations

import hmac
import os

import gitlab
from fastapi import FastAPI, Header, HTTPException, Request

import config
from agent.prompts import MR_REVIEW_TEMPLATE
from agent.runner import ask

app = FastAPI(title="GitLab Oracle Webhook")

_WEBHOOK_SECRET = os.environ.get("GITLAB_WEBHOOK_SECRET", "")
_NO_CONTEXT = "NO_HISTORICAL_CONTEXT"


def _gl():
    return gitlab.Gitlab(url=config.GITLAB_URL, private_token=config.get_secret("gitlab-pat"))


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
    if action not in ("open", "reopen", "update"):
        return {"skipped": f"action={action}"}

    project_id = payload["project"]["id"]
    mr_iid = attrs["iid"]

    prompt = MR_REVIEW_TEMPLATE.format(
        iid=mr_iid,
        title=attrs.get("title", ""),
        source_branch=attrs.get("source_branch", ""),
        target_branch=attrs.get("target_branch", ""),
        description=attrs.get("description", "") or "(no description)",
    )
    review = await ask(prompt, user_id="webhook", session_id=f"mr-{project_id}-{mr_iid}")

    if not review or _NO_CONTEXT in review:
        return {"mr": mr_iid, "posted": False, "reason": "no relevant history"}

    body = f"### 🧠 GitLab Oracle — Institutional Memory\n\n{review}"
    gl = _gl()
    project = gl.projects.get(project_id)
    mr = project.mergerequests.get(mr_iid)
    mr.notes.create({"body": body})
    return {"mr": mr_iid, "posted": True}
