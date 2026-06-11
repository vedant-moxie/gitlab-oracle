from __future__ import annotations

"""The four institutional-memory tools exposed to the Gemini agent.

Each returns JSON-serializable dicts with `citations` (web URLs) so the agent
can ground every claim in a specific commit / MR / issue.
"""

import functools
import logging

from agent import store
from agent.live import (
    lookup as _live_lookup,
    blame as _live_blame,
    repo_structure as _live_repo_structure,
    commit_diff as _live_commit_diff,
)

log = logging.getLogger(__name__)

def _safe_tool(fn):
    """Never let a tool exception kill the whole agent run.

    A failing backend (e.g. Vector Search unreachable) returns an error payload
    the model can reason about, so it degrades to its other tools instead of
    surfacing a 500 to the user.
    """

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            log.warning("tool %s failed: %s", fn.__name__, e)
            return {
                "error": f"{fn.__name__} is temporarily unavailable ({e.__class__.__name__}).",
                "hint": (
                    "Deep-history semantic recall could not be reached. Answer using your "
                    "other tools (e.g. lookup_reference / explain_blame query live GitLab) "
                    "and tell the user that institutional-memory search is temporarily "
                    "degraded, so the answer may be incomplete."
                ),
            }

    return wrapper

def _cite(doc: dict) -> dict:
    return {
        "kind": doc.get("_kind") or doc.get("source_type"),
        "ref": doc.get("short_id") or doc.get("iid") or doc.get("_id"),
        "title": doc.get("title") or (doc.get("message") or "").splitlines()[0:1],
        "url": doc.get("web_url"),
        "score": doc.get("_score"),
    }

def lookup_reference(reference: str) -> dict:
    """Resolve a SPECIFIC commit SHA, merge request (!123), or issue (#123) to its
    real, current record from GitLab — message, changed files, and (for a merge
    commit) the linked MR's authoritative title and description.

    ALWAYS use this when the user names or pastes a specific commit/MR/issue.
    Never describe a commit's purpose from its branch name or a loose search match.

    Args:
        reference: e.g. "172d400e", "!237909", or "#525094".

    Returns:
        The authoritative record, or an {"error": ...} if it can't be resolved.
    """
    return _live_lookup(reference)

def search_decision_history(query: str, file_path: str = "") -> dict:
    """Search the repository's full history for past decisions, discussions, and
    changes semantically related to a query. Use this to answer "has this been
    tried before?" or "what's the history around X?".

    Args:
        query: Natural-language description of the approach, bug, or concept.
        file_path: Optional repo-relative path to scope results to one file.

    Returns:
        Matching decisions/commits/MRs/issues with citations, most relevant first.
    """
    hits = store.semantic_search(
        query, k=10, file_path=file_path or None,
        node_types=["decision", "mr", "commit", "issue"],
    )
    degraded = any(h.get("_match") == "keyword-fallback" for h in hits)
    return {
        "query": query,
        "search_mode": (
            "keyword-fallback — semantic index unavailable; results are lexical "
            "matches from the ingested memory (disclose this to the user)"
            if degraded else "semantic"
        ),
        "results": [
            {
                "summary": (h.get("title") or h.get("message") or h.get("description") or "")[:400],
                "outcome": h.get("outcome"),
                "when": h.get("timestamp") or h.get("created_at"),
                "citation": _cite(h),
            }
            for h in hits
        ],
    }

def get_reversion_history(concept_or_file: str) -> dict:
    """Find approaches that were ATTEMPTED AND REVERTED, plus the discussion of
    why they failed. Use this when reviewing a new MR to warn about repeats.

    Args:
        concept_or_file: The approach or file path to check for prior reversions.

    Returns:
        Reverted decisions related to the concept, with the MR/issue trail.
    """
    related = store.semantic_search(
        concept_or_file, k=8, node_types=["decision", "mr"],
    )
    reverted = [r for r in related if r.get("outcome") == "reverted" or r.get("was_reverted")]
    enriched = []
    for r in reverted:
        item = {"summary": (r.get("title") or "")[:400], "citation": _cite(r)}
        # hop to the originating MR + incident issue if known
        if r.get("reverted_mr_id"):
            mr = store.get_mr(r["reverted_mr_id"])
            if mr:
                item["reverted_merge_request"] = {
                    "iid": mr.get("iid"), "title": mr.get("title"), "url": mr.get("web_url"),
                }
        for iid in (r.get("linked_issues") or [])[:3]:
            issue = store.get_issue(iid)
            if issue:
                item.setdefault("related_incidents", []).append(
                    {"iid": issue.get("iid"), "title": issue.get("title"), "url": issue.get("web_url")}
                )
        enriched.append(item)
    return {"concept": concept_or_file, "reversions": enriched,
            "note": "No prior reversions found." if not enriched else ""}

def explain_code_decision(file_path: str, line_range: str = "") -> dict:
    """Assemble the narrative of how a file (or region) came to exist: the
    chronological commits that shaped it and the decisions/issues behind them.

    Args:
        file_path: Repo-relative path, e.g. "src/payments/queue.py".
        line_range: Optional "start-end" hint (used for semantic focus only).

    Returns:
        Chronological history + the most relevant design decisions for the file.
    """
    timeline = store.commits_touching_file(file_path, limit=25)
    decisions = store.semantic_search(
        f"design decision for {file_path} {line_range}".strip(),
        k=6, file_path=file_path or None, node_types=["decision", "mr"],
    )
    return {
        "file": file_path,
        "timeline": [
            {"when": c.get("timestamp"), "change": (c.get("message") or "").splitlines()[0],
             "author": c.get("author"), "citation": _cite(c)}
            for c in timeline
        ],
        "key_decisions": [
            {"summary": (d.get("title") or "")[:300], "outcome": d.get("outcome"),
             "citation": _cite(d)}
            for d in decisions
        ],
    }

def onboarding_brief(developer_background: str) -> dict:
    """Given a new developer's background, surface the architectural decisions in
    this codebase most likely to surprise them, and why each was made.

    Args:
        developer_background: e.g. "Django backend, mostly monoliths".

    Returns:
        Surprising decisions with rationale citations.
    """
    decisions = store.semantic_search(
        f"surprising or non-obvious architectural decision relative to a developer "
        f"familiar with: {developer_background}",
        k=8, node_types=["decision", "mr"],
    )
    return {
        "background": developer_background,
        "surprises": [
            {"decision": (d.get("title") or "")[:300], "outcome": d.get("outcome"),
             "when": d.get("timestamp") or d.get("created_at"), "citation": _cite(d)}
            for d in decisions
        ],
    }

def get_recent_activity(days: int = 30) -> dict:
    """Chronological digest of the NEWEST commits, merge requests and issues in
    the repository's memory. Use this for any time-bounded question: "what
    changed recently?", "summarize the last month", "what's been happening?".

    Args:
        days: Size of the lookback window in days (default 30).

    Returns:
        Newest commits/MRs/issues with citations. If `window_empty` is true for
        a section, the memory snapshot predates the window and the newest
        available records are returned instead — say so in the answer.
    """
    data = store.recent_activity(days=days)
    return {
        "days": days,
        "commits": [
            {"when": c.get("timestamp"), "change": (c.get("message") or "").splitlines()[0][:200],
             "author": c.get("author"), "citation": _cite(c)}
            for c in data.get("commits", [])
        ],
        "merge_requests": [
            {"when": m.get("created_at"), "title": (m.get("title") or "")[:200],
             "state": m.get("state"), "citation": _cite(m)}
            for m in data.get("merge_requests", [])
        ],
        "issues": [
            {"when": i.get("created_at"), "title": (i.get("title") or "")[:200],
             "state": i.get("state"), "citation": _cite(i)}
            for i in data.get("issues", [])
        ],
        "window_empty": {
            "commits": data.get("commits_window_empty"),
            "merge_requests": data.get("merge_requests_window_empty"),
            "issues": data.get("issues_window_empty"),
        },
    }

def explain_blame(file_path: str, line_number: int) -> dict:
    """Find the specific commit that last modified a line, and explain its context.

    Use this when the user asks "who wrote this line?", "why does this specific
    line exist?", or "what MR introduced this bug on line X?".

    Args:
        file_path: Repo-relative path, e.g. "src/payments/queue.py".
        line_number: The 1-indexed line number to investigate.

    Returns:
        The commit/MR that introduced the line, with citations.
    """
    return _live_blame(file_path, line_number)

def get_commit_diff(reference: str) -> dict:
    """Fetch the ACTUAL code diff of a specific commit, straight from GitLab.

    Use this whenever the user asks to explain WHAT a commit changed in detail,
    what was added/removed, or how something was implemented. lookup_reference
    only returns the message and file list — this returns the real patch text
    so you can explain the change line by line.

    Args:
        reference: A commit SHA (7-40 hex chars), e.g. "c7d0b40f".

    Returns:
        The commit's diff text (possibly truncated for very large commits),
        message, author, changed files, and web_url — or an {"error": ...}.
    """
    return _live_commit_diff(reference)


def list_reverted_changes(limit: int = 15) -> dict:
    """List the reverted decisions recorded in this repository's memory — the
    catalog of approaches that were tried and undone.

    Use this FIRST for broad questions like "what has been reverted?", "what
    past mistakes should we learn from?", "tell me stories of changes that were
    undone". Then drill into individual items with lookup_reference /
    get_reversion_history using the titles and MR ids returned here.

    Args:
        limit: Maximum number of reverted decisions to return (default 15).

    Returns:
        Reverted decisions with title, source MR/commit, timestamp and web_url.
    """
    rows = store.reverted_decisions(limit=limit)
    return {
        "count": len(rows),
        "reverted": [
            {
                "title": (r.get("title") or "")[:200],
                "source": f"{r.get('source_type')}:{r.get('source_id')}",
                "reverted_mr_id": r.get("reverted_mr_id"),
                "linked_issues": (r.get("linked_issues") or [])[:3],
                "when": r.get("timestamp"),
                "url": r.get("web_url"),
            }
            for r in rows
        ],
    }


def get_repository_structure(path: str = "") -> dict:
    """Return the LIVE directory layout, language breakdown and README excerpt for
    the current project, read straight from GitLab.

    Use this for structural / onboarding questions the historical memory cannot
    answer on its own: "how is this repo structured?", "walk me through the
    layout", "what's in the codebase?", "where does X live?". Pass `path` to drill
    into a subdirectory (e.g. "app/models").

    Args:
        path: Optional repo-relative directory to list. Empty = repository root.

    Returns:
        directories, files, languages, and a README excerpt — or an {"error": ...}.
    """
    return _live_repo_structure(path)

# Plain functions; ADK wraps these as FunctionTools automatically.
# _safe_tool preserves each function's name/docstring/signature for ADK.
MEMORY_TOOLS = [
    _safe_tool(f)
    for f in (
        lookup_reference,
        search_decision_history,
        get_reversion_history,
        explain_code_decision,
        onboarding_brief,
        explain_blame,
        get_recent_activity,
        get_repository_structure,
        get_commit_diff,
        list_reverted_changes,
    )
]
