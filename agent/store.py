from __future__ import annotations

"""Retrieval layer: Vector Search neighbors -> Firestore documents + graph hops.

Datapoint IDs are namespaced so a neighbor maps straight to a Firestore doc:
    commit:<sha>   mr:<iid>   issue:<iid>   decision:<src_type>:<src_id>
"""

from functools import lru_cache

from google.cloud import firestore

import config
from agent import context
from ingestion import embed
from ingestion.vector_index import search

@lru_cache(maxsize=1)
def _db() -> firestore.Client:
    return firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)

def project_col(db: firestore.Client, project_id: str, name: str):
    """Project-scoped collection reference.

    The original single-tenant ingest (GITLAB_UPSTREAM_PROJECT) lives in
    TOP-LEVEL collections (commits/, merge_requests/, ...). Projects ingested
    after the multi-tenant refactor are namespaced under
    projects/<url-encoded-id>/ — the id is encoded because Firestore document
    ids cannot contain '/'.
    """
    if str(project_id) == config.GITLAB_UPSTREAM_PROJECT:
        return db.collection(name)
    from urllib.parse import quote

    return db.collection("projects").document(quote(str(project_id), safe="")).collection(name)

def _col(name: str):
    """Get a project-scoped collection reference from the request context."""
    pid = context.current_project_id.get()
    if not pid:
        raise ValueError("current_project_id is not set in context")
    return project_col(_db(), str(pid), name)

def _resolve(datapoint_id: str) -> dict | None:
    """Turn a vector datapoint id into its full Firestore document."""
    kind, _, rest = datapoint_id.partition(":")
    col = {
        "commit": config.COL_COMMITS,
        "mr": config.COL_MRS,
        "issue": config.COL_ISSUES,
        "decision": config.COL_DECISIONS,
    }.get(kind)
    if not col:
        return None
    doc = _col(col).document(rest).get()
    if not doc.exists:
        return None
    out = doc.to_dict()
    out["_kind"] = kind
    out["_id"] = rest
    return out

def semantic_search(
    query: str,
    k: int = 8,
    node_types: list[str] | None = None,
    file_path: str | None = None,
) -> list[dict]:
    """Embed the query, find neighbors, hydrate them from Firestore."""
    pid = context.current_project_id.get()
    if not pid:
        raise ValueError("current_project_id is not set in context")
    vec = embed.embed_query(query)
    hits = search(vec, project_id=str(pid), k=k, node_types=node_types, file_path=file_path)
    results = []
    for dp_id, dist in hits:
        doc = _resolve(dp_id)
        if doc:
            # DOT_PRODUCT over normalized embeddings -> returned distance IS the
            # cosine-like similarity (higher = closer).
            doc["_score"] = round(dist, 4)
            doc["_rank"] = len(results)
            results.append(doc)
    return results

def get_mr(iid: int | str) -> dict | None:
    doc = _col(config.COL_MRS).document(str(iid)).get()
    return doc.to_dict() if doc.exists else None

def get_issue(iid: int | str) -> dict | None:
    doc = _col(config.COL_ISSUES).document(str(iid)).get()
    return doc.to_dict() if doc.exists else None

def commits_touching_file(file_path: str, limit: int = 20) -> list[dict]:
    """Chronological commits whose diff touched a file (graph-style lookup)."""
    q = (
        _col(config.COL_COMMITS)
        .where("files", "array_contains", file_path)
        .limit(limit)
    )
    rows = [d.to_dict() for d in q.stream()]
    rows.sort(key=lambda r: r.get("timestamp") or "")
    return rows

def recent_activity(days: int = 30, limit: int = 20) -> dict:
    """Newest commits / MRs / issues, newest first. Firestore-only (no vector search).

    Timestamps are ISO-8601 strings, so lexicographic order == chronological.
    Falls back to the newest few records when the window is empty (the memory is
    a snapshot — 'last month' may predate the latest ingestion).
    """
    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out: dict = {}
    for key, col, field in (
        ("commits", config.COL_COMMITS, "timestamp"),
        ("merge_requests", config.COL_MRS, "created_at"),
        ("issues", config.COL_ISSUES, "created_at"),
    ):
        q = _col(col).order_by(field, direction=firestore.Query.DESCENDING).limit(limit)
        rows = [d.to_dict() for d in q.stream()]
        in_window = [r for r in rows if (r.get(field) or "") >= cutoff]
        out[key] = in_window if in_window else rows[:5]
        out[f"{key}_window_empty"] = not in_window
    return out

def reverted_decisions(limit: int = 25) -> list[dict]:
    q = (
        _col(config.COL_DECISIONS)
        .where("outcome", "==", "reverted")
        .limit(limit)
    )
    return [d.to_dict() for d in q.stream()]
