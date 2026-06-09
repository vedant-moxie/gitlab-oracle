"""GitLab Oracle — ingestion pipeline.

Backfills a repository's institutional memory:
  GitLab REST (UPSTREAM project)  ->  Firestore temporal graph  +  Vertex Vector Search

Run from the project root:
    ./venv/bin/python -m ingestion.main

Env (see .env.example): GITLAB_UPSTREAM_PROJECT, GITLAB_PAT (or Secret Manager
'gitlab-pat'), VECTOR_INDEX_ID, GOOGLE_CLOUD_PROJECT/LOCATION.
Optional caps for a fast demo backfill:
    MAX_COMMITS (default 1500), SINCE_DAYS (default 730), FETCH_DIFFS (default 1)
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import gitlab
from google.cloud import firestore

import config
from ingestion import embed
from ingestion.relationships import parse
from ingestion.vector_index import Datapoint, upsert

MAX_COMMITS = int(os.environ.get("MAX_COMMITS", "1200"))
MAX_MRS = int(os.environ.get("MAX_MRS", "500"))
MAX_ISSUES = int(os.environ.get("MAX_ISSUES", "400"))
SINCE_DAYS = int(os.environ.get("SINCE_DAYS", "730"))
FETCH_DIFFS = os.environ.get("FETCH_DIFFS", "1") == "1"
# Targeted search so the memory is guaranteed to contain reverted decisions
# even when sampling a huge repo. Set MR_SEARCH="" to disable.
MR_SEARCH = os.environ.get("MR_SEARCH", "Revert")
_BATCH = 100


def _now_minus(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _gl_project(project_id: str, token: str):
    gl = gitlab.Gitlab(url=config.GITLAB_URL, private_token=token)
    gl.auth()
    return gl.projects.get(project_id)


def _flush(db, project_id: str, fs_batch_docs: list[tuple[str, str, dict]], vec_points: list[Datapoint]):
    """Write a wave of docs to Firestore (batched) and vectors to Vector Search."""
    # Firestore: max 500 writes/batch
    for i in range(0, len(fs_batch_docs), 400):
        batch = db.batch()
        for col, doc_id, data in fs_batch_docs[i : i + 400]:
            ref = db.collection("projects").document(project_id).collection(col).document(doc_id)
            batch.set(ref, data, merge=True)
        batch.commit()
    upsert(vec_points)


def ingest_issues(project_id: str, project, db) -> int:
    print("📥 Issues...")
    docs, points, texts, metas = [], [], [], []
    n = 0
    for issue in project.issues.list(
        updated_after=_now_minus(SINCE_DAYS), order_by="updated_at", sort="desc",
        iterator=True,
    ):
        if n >= MAX_ISSUES:
            print(f"   ⚠️  hit MAX_ISSUES={MAX_ISSUES}; older issues skipped (raise MAX_ISSUES for more).")
            break
        text = f"Issue #{issue.iid}: {issue.title}\n{issue.description or ''}"
        data = {
            "iid": issue.iid,
            "title": issue.title,
            "description": issue.description,
            "labels": issue.labels,
            "state": issue.state,
            "created_at": issue.created_at,
            "closed_at": getattr(issue, "closed_at", None),
            "web_url": issue.web_url,
        }
        docs.append((config.COL_ISSUES, str(issue.iid), data))
        texts.append(text)
        metas.append(("issue", f"issue:{issue.iid}", None))
        n += 1
        if len(texts) >= _BATCH:
            _embed_and_stage(project_id, texts, metas, points)
            _flush(db, project_id, docs, points)
            docs, points, texts, metas = [], [], [], []
    if texts:
        _embed_and_stage(project_id, texts, metas, points)
        _flush(db, project_id, docs, points)
    print(f"   {n} issues")
    return n


def _mr_source(project):
    """Yield MRs to ingest: a targeted 'Revert' search first (guarantees reverted
    decisions in the memory), then the most recently updated MRs. Both passes are
    guarded — on huge repos the search can time out (408); we degrade gracefully."""
    if MR_SEARCH:
        try:
            for mr in project.mergerequests.list(
                search=MR_SEARCH, in_="title", state="merged",
                created_after=_now_minus(SINCE_DAYS),
                order_by="updated_at", sort="desc", per_page=50, iterator=True,
            ):
                yield mr
        except Exception as e:
            print(f"   (revert-search pass skipped: {e})")
    try:
        for mr in project.mergerequests.list(
            updated_after=_now_minus(SINCE_DAYS),
            order_by="updated_at", sort="desc", per_page=50, iterator=True,
        ):
            yield mr
    except Exception as e:
        print(f"   (recent-MR pass truncated: {e})")


def ingest_mrs(project_id: str, project, db) -> int:
    print("📥 Merge requests (+ review comments)...")
    docs, points, texts, metas = [], [], [], []
    n = 0
    seen: set[int] = set()
    for mr in _mr_source(project):
        if n >= MAX_MRS:
            print(f"   ⚠️  hit MAX_MRS={MAX_MRS}; older MRs skipped (raise MAX_MRS for more).")
            break
        if mr.iid in seen:
            continue
        seen.add(mr.iid)
        comments = []
        try:
            comments = [note.body for note in mr.notes.list(iterator=True) if not note.system]
        except Exception:
            pass
        rel = parse(f"{mr.title}\n{mr.description or ''}\n" + "\n".join(comments))
        text = (
            f"MR !{mr.iid}: {mr.title}\n{mr.description or ''}\n"
            f"Review discussion:\n" + "\n".join(comments[:30])
        )
        data = {
            "iid": mr.iid,
            "title": mr.title,
            "description": mr.description,
            "state": mr.state,
            "created_at": mr.created_at,
            "merged_at": mr.merged_at,
            "closed_at": mr.closed_at,
            "source_branch": mr.source_branch,
            "target_branch": mr.target_branch,
            "web_url": mr.web_url,
            "review_comments": comments[:50],
            **rel.to_dict(),
        }
        docs.append((config.COL_MRS, str(mr.iid), data))
        texts.append(text)
        metas.append(("mr", f"mr:{mr.iid}", None))
        if rel.is_decision:
            _stage_decision(docs, texts, metas, src_type="mr", src_id=mr.iid,
                            title=mr.title, text=text, rel=rel,
                            ts=mr.created_at, url=mr.web_url)
        n += 1
        if len(texts) >= _BATCH:
            _embed_and_stage(project_id, texts, metas, points)
            _flush(db, project_id, docs, points)
            docs, points, texts, metas = [], [], [], []
    if texts:
        _embed_and_stage(project_id, texts, metas, points)
        _flush(db, project_id, docs, points)
    print(f"   {n} merge requests")
    return n


def ingest_commits(project_id: str, project, db) -> int:
    print("📥 Commits...")
    docs, points, texts, metas = [], [], [], []
    n = 0
    for commit in project.commits.list(since=_now_minus(SINCE_DAYS), iterator=True):
        if n >= MAX_COMMITS:
            print(f"   ⚠️  hit MAX_COMMITS={MAX_COMMITS}; older commits skipped (raise MAX_COMMITS to ingest all).")
            break
        files = []
        if FETCH_DIFFS:
            try:
                detail = project.commits.get(commit.id)
                files = [d.get("new_path") for d in detail.diff(get_all=True)][:100]
            except Exception:
                pass
        rel = parse(commit.message)
        text = f"Commit {commit.short_id}: {commit.message}\nAuthor: {commit.author_name}"
        data = {
            "sha": commit.id,
            "short_id": commit.short_id,
            "message": commit.message,
            "author": commit.author_name,
            "timestamp": commit.created_at,
            "files": files,
            "web_url": commit.web_url,
            **rel.to_dict(),
        }
        docs.append((config.COL_COMMITS, commit.id, data))
        texts.append(text)
        metas.append(("commit", f"commit:{commit.id}", files))
        if rel.is_decision:
            _stage_decision(docs, texts, metas, src_type="commit", src_id=commit.id,
                            title=commit.message.splitlines()[0], text=text, rel=rel,
                            ts=commit.created_at, url=commit.web_url)
        n += 1
        if len(texts) >= _BATCH:
            _embed_and_stage(project_id, texts, metas, points)
            _flush(db, project_id, docs, points)
            docs, points, texts, metas = [], [], [], []
    if texts:
        _embed_and_stage(project_id, texts, metas, points)
        _flush(db, project_id, docs, points)
    print(f"   {n} commits")
    return n


def _stage_decision(docs, texts, metas, *, src_type, src_id, title, text, rel, ts, url):
    """Emit a DecisionNode alongside its source commit/MR."""
    did = f"decision:{src_type}:{src_id}"
    docs.append((config.COL_DECISIONS, f"{src_type}:{src_id}", {
        "source_type": src_type,
        "source_id": str(src_id),
        "title": title,
        "outcome": "reverted" if rel.is_reversion else "implemented",
        "reverted_mr_id": rel.reverted_mr_id,
        "reverted_sha": rel.reverted_sha,
        "linked_issues": rel.linked_issues,
        "linked_mrs": rel.linked_mrs,
        "timestamp": ts,
        "web_url": url,
    }))
    texts.append(f"DECISION ({'reverted' if rel.is_reversion else 'implemented'}): {text}")
    metas.append(("decision", did, None))


def _embed_and_stage(project_id: str, texts: list[str], metas: list[tuple], points: list[Datapoint]):
    vectors = embed.embed_documents(texts)
    for (node_type, dp_id, files), vec in zip(metas, vectors):
        points.append(Datapoint(id=dp_id, vector=vec, node_type=node_type, project_id=project_id, files=files))


def resolve_reversion_edges(project_id: str, db) -> int:
    """Link decisions that reverted a known MR back to that MR document."""
    print("🔗 Resolving reversion edges...")
    n = 0
    for dec in db.collection("projects").document(project_id).collection(config.COL_DECISIONS).where("outcome", "==", "reverted").stream():
        d = dec.to_dict()
        target = d.get("reverted_mr_id")
        if target is not None:
            db.collection("projects").document(project_id).collection(config.COL_MRS).document(str(target)).set(
                {"reverted_by": dec.id, "was_reverted": True}, merge=True
            )
            n += 1
    print(f"   {n} reversion edges")
    return n


def main():
    print("🚀 GitLab Oracle ingestion")
    project_id = config.GITLAB_UPSTREAM_PROJECT
    token = config.get_secret("gitlab-pat")
    if not project_id:
        sys.exit("❌ Set GITLAB_UPSTREAM_PROJECT.")
    print(f"   upstream={project_id}  project={config.PROJECT_ID}")
    if not config.VECTOR_INDEX_ID:
        sys.exit("❌ Set VECTOR_INDEX_ID (run deploy/01_provision_gcp.sh first).")

    project = _gl_project(project_id, token)
    db = firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)

    total = 0
    for fn in (ingest_issues, ingest_mrs, ingest_commits):
        try:
            total += fn(project_id, project, db)
        except Exception as e:
            print(f"   ⚠️  {fn.__name__} failed, continuing: {e}")
    try:
        resolve_reversion_edges(project_id, db)
    except Exception as e:
        print(f"   ⚠️  reversion-edge resolution failed: {e}")

    print(f"✅ Done. Ingested ~{total} primary nodes into Firestore + Vector Search.")


if __name__ == "__main__":
    main()
