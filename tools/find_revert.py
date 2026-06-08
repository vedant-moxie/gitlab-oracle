"""List reverted decisions in the ingested memory — pick one to re-attempt on the
fork for the demo money-shot.

    PYTHONPATH=. ./venv/bin/python -m tools.find_revert
"""
from __future__ import annotations

from google.cloud import firestore

import config


def main():
    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    rows = list(
        db.collection(config.COL_DECISIONS).where("outcome", "==", "reverted").limit(40).stream()
    )
    if not rows:
        print("No reverted decisions found. Run ingestion first (and keep MR_SEARCH=Revert).")
        return
    print(f"Found {len(rows)} reverted decisions:\n")
    for r in rows:
        d = r.to_dict()
        title = (d.get("title") or "").splitlines()[0][:90]
        rev_mr = d.get("reverted_mr_id")
        issues = d.get("linked_issues") or []
        print(f"• [{d.get('source_type')}:{d.get('source_id','')[:12]}] {title}")
        if rev_mr:
            print(f"    reverted MR: !{rev_mr}")
        if issues:
            print(f"    linked issues: {issues}")
        if d.get("web_url"):
            print(f"    {d['web_url']}")
        print()


if __name__ == "__main__":
    main()
