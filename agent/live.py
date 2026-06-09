"""Live GitLab lookups for exact references (commit SHA / !MR / #issue).

Used by the `lookup_reference` tool so the agent grounds specific-reference
answers in the REAL, current record — never inferring from branch names or
loose semantic matches. Reads from the upstream project via python-gitlab.
"""
from __future__ import annotations

import re
from functools import lru_cache

import gitlab

import config
from ingestion.relationships import parse

_SHA_RE = re.compile(r"\b([0-9a-f]{7,40})\b", re.I)
_MR_RE = re.compile(r"!(\d+)\b")
_ISSUE_RE = re.compile(r"#(\d+)\b")


@lru_cache(maxsize=1)
def _project():
    gl = gitlab.Gitlab(url=config.GITLAB_URL, private_token=config.get_secret("gitlab-pat"))
    return gl.projects.get(config.GITLAB_UPSTREAM_PROJECT)


def _mr_summary(p, iid: int) -> dict:
    mr = p.mergerequests.get(iid)
    return {
        "type": "merge_request",
        "iid": mr.iid,
        "title": mr.title,
        "state": mr.state,
        "description": (mr.description or "")[:4000],
        "author": getattr(mr.author, "get", lambda *_: None) and mr.author.get("name"),
        "merged_at": mr.merged_at,
        "web_url": mr.web_url,
    }


def lookup(reference: str) -> dict:
    """Resolve a commit SHA, !MR, or #issue to its authoritative GitLab record."""
    ref = (reference or "").strip()
    try:
        p = _project()
    except Exception as e:
        return {"error": f"could not reach GitLab: {e}"}

    # ---- explicit issue (#123) ----
    if (m := _ISSUE_RE.search(ref)) and ref.lstrip().startswith("#"):
        try:
            i = p.issues.get(int(m.group(1)))
            return {"type": "issue", "iid": i.iid, "title": i.title, "state": i.state,
                    "labels": i.labels, "description": (i.description or "")[:4000],
                    "web_url": i.web_url}
        except Exception as e:
            return {"error": f"issue #{m.group(1)} not found: {e}"}

    # ---- explicit MR (!123) ----
    if (m := _MR_RE.search(ref)):
        try:
            return _mr_summary(p, int(m.group(1)))
        except Exception as e:
            return {"error": f"MR !{m.group(1)} not found: {e}"}

    # ---- commit SHA ----
    if (m := _SHA_RE.search(ref)):
        sha = m.group(1)
        try:
            c = p.commits.get(sha)
        except Exception as e:
            return {"error": f"commit {sha} not found: {e}"}
        try:
            files = [d.get("new_path") for d in c.diff(get_all=True)][:60]
        except Exception:
            files = []
        msg = c.message or ""
        out = {
            "type": "commit",
            "sha": c.id,
            "short_id": c.short_id,
            "subject": msg.splitlines()[0] if msg else "",
            "message": msg[:2000],
            "author": c.author_name,
            "created_at": c.created_at,
            "changed_files": files,
            "web_url": c.web_url,
            "note": "Branch names in merge messages are NOT reliable indicators of "
                    "content — describe this change from the subject, files, and linked MR only.",
        }
        # hop to the linked MR for the authoritative "what & why"
        rel = parse(msg)
        if rel.linked_mrs:
            try:
                out["linked_merge_request"] = _mr_summary(p, rel.linked_mrs[0])
            except Exception:
                pass
        return out

def blame(file_path: str, line_number: int) -> dict:
    """Fetch the commit that last modified a specific line in a file."""
    try:
        p = _project()
        # GitLab blame API returns a list of blocks
        blame_blocks = p.files.blame(file_path, ref="HEAD")
        current_line = 1
        for block in blame_blocks:
            lines_in_block = len(block["lines"])
            if current_line <= line_number < current_line + lines_in_block:
                commit_id = block["commit"]["id"]
                return lookup(commit_id)
            current_line += lines_in_block
        return {"error": f"Line {line_number} not found in {file_path}"}
    except Exception as e:
        return {"error": f"Could not fetch blame for {file_path}: {e}"}
