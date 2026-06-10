from __future__ import annotations

"""Live GitLab lookups for exact references (commit SHA / !MR / #issue).

Used by the `lookup_reference` tool so the agent grounds specific-reference
answers in the REAL, current record — never inferring from branch names or
loose semantic matches. Reads from the upstream project via python-gitlab.
"""

import re
from functools import lru_cache

import gitlab

import config
from ingestion.relationships import parse

from agent import context

_SHA_RE = re.compile(r"\b([0-9a-f]{7,40})\b", re.I)
_MR_RE = re.compile(r"!(\d+)\b")
_ISSUE_RE = re.compile(r"#(\d+)\b")

def _project():
    pid = context.current_project_id.get()
    tok = context.current_gitlab_token.get() or config.get_secret("gitlab-pat")
    gl = gitlab.Gitlab(url=config.GITLAB_URL, private_token=tok)
    return gl.projects.get(pid)

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

    # No regex matched — make this explicit so the agent can recover gracefully
    # instead of receiving `None` (which ADK's tool-result serialization rejects).
    return {
        "error": f"could not recognize '{reference}' as a commit SHA, !MR, or #issue.",
        "hint": "Pass a 7-40 char hex SHA, a !MR ref (e.g. '!237909'), or a #issue ref.",
    }

def commit_diff(reference: str) -> dict:
    """Fetch the ACTUAL diff text of a commit so the agent can explain in detail
    what code changed — not just which files. Caps total size to stay within the
    model's context comfortably."""
    ref = (reference or "").strip()
    m = _SHA_RE.search(ref)
    if not m:
        return {"error": f"'{reference}' is not a commit SHA."}
    sha = m.group(1)
    try:
        p = _project()
        c = p.commits.get(sha)
    except Exception as e:
        return {"error": f"commit {sha} not found: {e}"}

    max_chars = 18000
    chunks: list[str] = []
    files: list[str] = []
    total = 0
    truncated = False
    try:
        diffs = c.diff(get_all=True)
    except Exception as e:
        return {"error": f"could not fetch diff for {sha}: {e}"}
    for d in diffs:
        path = d.get("new_path") or d.get("old_path")
        files.append(path)
        if truncated:
            continue
        text = f"--- {d.get('old_path')}\n+++ {d.get('new_path')}\n{d.get('diff') or ''}"
        if total + len(text) > max_chars:
            truncated = True
            continue
        chunks.append(text)
        total += len(text)
    return {
        "sha": c.id,
        "subject": (c.message or "").splitlines()[0],
        "message": (c.message or "")[:2000],
        "author": c.author_name,
        "created_at": c.created_at,
        "files_changed": files,
        "diff": "\n".join(chunks),
        "diff_truncated": truncated,
        "web_url": c.web_url,
    }


def repo_structure(path: str = "") -> dict:
    """Fetch the LIVE directory tree, README excerpt and language breakdown for the
    current project straight from GitLab — the authoritative "how is this repo laid
    out" answer that the commit/MR/issue memory cannot provide."""
    try:
        p = _project()
    except Exception as e:
        return {"error": f"could not reach GitLab: {e}"}

    out: dict = {
        "project": getattr(p, "path_with_namespace", None),
        "default_branch": getattr(p, "default_branch", None),
        "description": getattr(p, "description", None),
    }

    # Top-level (or path-scoped) tree — directories first, then files.
    try:
        entries = p.repository_tree(path=path or "", ref=getattr(p, "default_branch", "HEAD"),
                                    per_page=100, get_all=True)
        dirs = sorted(e["name"] for e in entries if e["type"] == "tree")
        files = sorted(e["name"] for e in entries if e["type"] == "blob")
        out["path"] = path or "/"
        out["directories"] = dirs
        out["files"] = files
    except Exception as e:
        out["tree_error"] = f"could not list tree: {e}"

    # Language breakdown (gives an instant read on the stack).
    try:
        out["languages"] = p.languages()
    except Exception:
        pass

    # README excerpt — the project's own description of its layout.
    try:
        for name in ("README.md", "README.rst", "README", "readme.md"):
            try:
                f = p.files.get(file_path=name, ref=getattr(p, "default_branch", "HEAD"))
                import base64
                content = base64.b64decode(f.content).decode("utf-8", "replace")
                out["readme_excerpt"] = content[:3000]
                out["readme_file"] = name
                break
            except Exception:
                continue
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
