"""The four institutional-memory tools exposed to the Gemini agent.

Each returns JSON-serializable dicts with `citations` (web URLs) so the agent
can ground every claim in a specific commit / MR / issue.
"""
from __future__ import annotations

from agent import store
from agent.live import lookup as _live_lookup


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
    return {
        "query": query,
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


# Plain functions; ADK wraps these as FunctionTools automatically.
MEMORY_TOOLS = [
    lookup_reference,
    search_decision_history,
    get_reversion_history,
    explain_code_decision,
    onboarding_brief,
]
