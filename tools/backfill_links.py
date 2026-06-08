"""Re-parse stored commit/MR/decision records with the corrected reference parser
and overwrite their linked_issues / linked_mrs / reverted_mr_id fields.

Cleans up false-positive citations (stale bare-# matches) without re-ingesting.
Firestore-only; no GitLab API calls.

    PYTHONPATH=. ./venv/bin/python -m tools.backfill_links
"""
from __future__ import annotations

from google.cloud import firestore

import config
from ingestion.relationships import parse


def _text_for(doc: dict, kind: str) -> str:
    if kind == "commit":
        return doc.get("message") or ""
    if kind == "mr":
        return f"{doc.get('title','')}\n{doc.get('description','')}\n" + "\n".join(doc.get("review_comments") or [])
    if kind == "decision":
        return doc.get("title") or ""
    return ""


def _scrub(db, col: str, kind: str) -> int:
    n = 0
    batch = db.batch()
    pending = 0
    for snap in db.collection(col).stream():
        d = snap.to_dict()
        rel = parse(_text_for(d, kind))
        update = {"linked_issues": rel.linked_issues, "linked_mrs": rel.linked_mrs}
        if kind in ("commit", "decision"):
            update["is_reversion"] = rel.is_reversion
            update["reverted_mr_id"] = rel.reverted_mr_id
        batch.set(snap.reference, update, merge=True)
        n += 1
        pending += 1
        if pending >= 400:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()
    print(f"  {col}: re-parsed {n}")
    return n


def main():
    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    print("🧹 Re-parsing stored references with the corrected parser...")
    _scrub(db, config.COL_COMMITS, "commit")
    _scrub(db, config.COL_MRS, "mr")
    _scrub(db, config.COL_DECISIONS, "decision")
    print("✅ Citation cleanup complete.")


if __name__ == "__main__":
    main()
