"""Enrich the index with file-level revert involvement.

For each REVERTED decision sourced from an MR, fetch that MR's changed files
live from GitLab and tally how often each file appears in reverted work.
Stores the tally in Firestore (meta/file_revert_involvement) so the Risk Radar
hotspots can show a real 'reverts' signal. One-time / occasional backfill.

    PYTHONPATH=. ./venv/bin/python -m tools.enrich_revert_files
"""
from __future__ import annotations

from collections import defaultdict

import gitlab
from google.cloud import firestore

import config


def main():
    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)
    gl = gitlab.Gitlab(url=config.GITLAB_URL, private_token=config.get_secret("gitlab-pat"))
    project = gl.projects.get(config.GITLAB_UPSTREAM_PROJECT)

    reverted = [
        d.to_dict()
        for d in db.collection(config.COL_DECISIONS).where("outcome", "==", "reverted").stream()
    ]
    mr_iids = sorted({int(d["source_id"]) for d in reverted
                      if d.get("source_type") == "mr" and str(d.get("source_id", "")).isdigit()})
    print(f"Fetching changed files for {len(mr_iids)} reverted MRs...")

    involve: dict[str, int] = defaultdict(int)
    done = 0
    for iid in mr_iids:
        try:
            mr = project.mergerequests.get(iid)
            changes = mr.changes(access_raw_diffs=False).get("changes", [])
            for ch in changes[:100]:
                p = ch.get("new_path")
                if p:
                    involve[p] += 1
            done += 1
        except Exception as e:
            print(f"  !{iid}: skip ({str(e)[:60]})")
    print(f"  processed {done} MRs; {len(involve)} distinct files touched by reverted work")

    db.collection("meta").document("file_revert_involvement").set(
        {"counts": dict(involve), "mrs_scanned": done}
    )
    top = sorted(involve.items(), key=lambda kv: kv[1], reverse=True)[:8]
    print("Top files in reverted work:")
    for f, n in top:
        print(f"  {n}x  {f}")
    print("✅ Stored meta/file_revert_involvement")


if __name__ == "__main__":
    main()
