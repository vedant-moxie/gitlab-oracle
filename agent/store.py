"""Retrieval layer: Vector Search neighbors -> Firestore documents + graph hops.

Datapoint IDs are namespaced so a neighbor maps straight to a Firestore doc:
    commit:<sha>   mr:<iid>   issue:<iid>   decision:<src_type>:<src_id>
"""
from __future__ import annotations

from functools import lru_cache

from google.cloud import firestore

import config
from ingestion import embed
from ingestion.vector_index import search


@lru_cache(maxsize=1)
def _db() -> firestore.Client:
    return firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)


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
    doc = _db().collection(col).document(rest).get()
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
    vec = embed.embed_query(query)
    hits = search(vec, k=k, node_types=node_types, file_path=file_path)
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
    doc = _db().collection(config.COL_MRS).document(str(iid)).get()
    return doc.to_dict() if doc.exists else None


def get_issue(iid: int | str) -> dict | None:
    doc = _db().collection(config.COL_ISSUES).document(str(iid)).get()
    return doc.to_dict() if doc.exists else None


def commits_touching_file(file_path: str, limit: int = 20) -> list[dict]:
    """Chronological commits whose diff touched a file (graph-style lookup)."""
    q = (
        _db().collection(config.COL_COMMITS)
        .where("files", "array_contains", file_path)
        .limit(limit)
    )
    rows = [d.to_dict() for d in q.stream()]
    rows.sort(key=lambda r: r.get("timestamp") or "")
    return rows


def reverted_decisions(limit: int = 25) -> list[dict]:
    q = (
        _db().collection(config.COL_DECISIONS)
        .where("outcome", "==", "reverted")
        .limit(limit)
    )
    return [d.to_dict() for d in q.stream()]
