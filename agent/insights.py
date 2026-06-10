from __future__ import annotations

"""Insights over the institutional-memory graph: graph view, file hotspots, and
MR risk scoring. Powers the Knowledge Graph Explorer and the Risk Radar.
"""

import time
from collections import defaultdict
from functools import lru_cache

from google.cloud import firestore

import config

_cache: dict = {}
_TTL = 300

@lru_cache(maxsize=1)
def _db() -> firestore.Client:
    return firestore.Client(project=config.PROJECT_ID, database=config.FIRESTORE_DATABASE)

def _cached(key: str):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    return None

def _put(key: str, val):
    _cache[key] = (time.time(), val)
    return val

def _col(project_id: str, name: str):
    from agent.store import project_col

    return project_col(_db(), project_id, name)

# ---------------------------------------------------------------- graph view
def build_graph(project_id: str, max_decisions: int = 130) -> dict:
    """Nodes + edges centered on decisions and their neighborhoods. Reverted
    decisions and their reversion edges are flagged for red rendering."""
    cache_key = f"graph:{project_id}"
    if (c := _cached(cache_key)):
        return c
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add_node(nid, label, ntype, url=None, reverted=False):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "label": (label or nid)[:60], "type": ntype,
                          "url": url, "reverted": reverted}

    # prioritize reverted decisions, then the rest
    reverted = list(_col(project_id, config.COL_DECISIONS).where("outcome", "==", "reverted").limit(max_decisions).stream())
    others = list(_col(project_id, config.COL_DECISIONS).where("outcome", "==", "implemented").limit(max_decisions).stream())
    for snap in (reverted + others)[:max_decisions]:
        d = snap.to_dict()
        is_rev = d.get("outcome") == "reverted"
        did = f"decision:{snap.id}"
        add_node(did, d.get("title"), "decision", d.get("web_url"), is_rev)
        # link to the originating MR / commit — red "reverted" edge if reverted
        src_type, src_id = d.get("source_type"), d.get("source_id")
        if src_type == "mr":
            mid = f"mr:{src_id}"
            add_node(mid, f"MR !{src_id}", "mr", d.get("web_url"), is_rev)
            edges.append({"from": did, "to": mid, "type": "reverted" if is_rev else "about"})
        # explicit reversion edge to a named reverted MR
        if d.get("reverted_mr_id"):
            rmid = f"mr:{d['reverted_mr_id']}"
            add_node(rmid, f"MR !{d['reverted_mr_id']}", "mr", None, True)
            edges.append({"from": did, "to": rmid, "type": "reverted"})
        # links to issues
        for iid in (d.get("linked_issues") or [])[:3]:
            nid = f"issue:{iid}"
            add_node(nid, f"#{iid}", "issue")
            edges.append({"from": did, "to": nid, "type": "links"})

    out = {"nodes": list(nodes.values()), "edges": edges,
           "counts": {"nodes": len(nodes), "edges": len(edges)}}
    return _put(cache_key, out)

# ---------------------------------------------------------------- hotspots
# Generated / lockfile noise that dominates churn but carries no design signal.
_NOISE = (
    ".pot", ".lock", "lock.json", "yarn.lock", "Gemfile.lock", "structure.sql",
    "db/schema.rb", ".min.js", ".map", "CHANGELOG", "doc/api/graphql/reference",
)

def _is_noise(path: str) -> bool:
    p = path.lower()
    return any(p.endswith(s) or s.lower() in p for s in (n.lower() for n in _NOISE))

def hotspots(project_id: str, top: int = 12) -> dict:
    """File-level risk analytics ranked by design signal: how often a file is
    touched by reverts and notable decisions, plus bus-factor (author
    concentration). Generated/lockfile noise is filtered out."""
    cache_key = f"hotspots:{project_id}"
    if (c := _cached(cache_key)):
        return c
    churn: dict[str, int] = defaultdict(int)
    reverts: dict[str, int] = defaultdict(int)
    decisions: dict[str, int] = defaultdict(int)
    authors: dict[str, set] = defaultdict(set)

    for snap in _col(project_id, config.COL_COMMITS).select(
        ["files", "author", "is_reversion", "is_decision"]
    ).stream():
        c = snap.to_dict()
        is_rev = bool(c.get("is_reversion"))
        is_dec = bool(c.get("is_decision"))
        author = c.get("author") or "?"
        for f in (c.get("files") or []):
            if not f or _is_noise(f):
                continue
            churn[f] += 1
            authors[f].add(author)
            if is_rev:
                reverts[f] += 1
            if is_dec:
                decisions[f] += 1

    # merge live revert-involvement (files actually changed by reverted MRs)
    try:
        inv = (_col(project_id, "meta").document("file_revert_involvement").get().to_dict() or {})
        for f, n in (inv.get("counts") or {}).items():
            if not _is_noise(f):
                reverts[f] = max(reverts.get(f, 0), int(n))
                churn.setdefault(f, 0)
                churn[f] = max(churn[f], int(n))
    except Exception:
        pass

    rows = []
    for f, ch in churn.items():
        risk = reverts.get(f, 0) * 20 + decisions.get(f, 0) * 4 + ch
        rows.append({
            "file": f, "churn": ch, "reverts": reverts.get(f, 0),
            "decisions": decisions.get(f, 0), "authors": len(authors[f]),
            "risk": risk, "bus_factor_risk": len(authors[f]) == 1 and ch >= 3,
        })
    rows.sort(key=lambda r: r["risk"], reverse=True)
    bus = sorted([r for r in rows if r["bus_factor_risk"]],
                 key=lambda r: r["churn"], reverse=True)[:top]
    out = {"hotspots": rows[:top], "bus_factor": bus, "total_files": len(churn)}
    return _put(cache_key, out)

# ---------------------------------------------------------------- risk score
def score_mr(project_id: str, title: str, description: str = "", files: list[str] | None = None) -> dict:
    """Risk score (0-100) for a proposed MR, with explainable reasons."""
    from agent import store  # lazy: needs Vector Search
    from agent import context
    context.current_project_id.set(project_id)

    files = files or []
    score = 8
    reasons: list[dict] = []

    text = f"{title}\n{description}".strip()
    hits = store.semantic_search(text, k=8, node_types=["decision", "mr"])

    def _is_reverted(h):
        return h.get("outcome") == "reverted" or h.get("was_reverted")

    # Rank-based: a reverted approach among the closest matches is the strong signal.
    top_rev = next((h for h in hits[:3] if _is_reverted(h)), None)
    near_rev = top_rev or next((h for h in hits[:8] if _is_reverted(h)), None)
    if top_rev:
        score += 55
        reasons.append({
            "kind": "reverted_precedent", "weight": 55,
            "text": f"Closely matches a previously REVERTED approach: "
                    f"{(top_rev.get('title') or '')[:90]}",
            "url": top_rev.get("web_url"),
        })
    elif near_rev:
        score += 28
        reasons.append({
            "kind": "reverted_precedent", "weight": 28,
            "text": f"Resembles a past reverted approach: "
                    f"{(near_rev.get('title') or '')[:90]}",
            "url": near_rev.get("web_url"),
        })
    elif hits:
        reasons.append({"kind": "prior_art", "weight": 0,
                        "text": "Related prior work exists (none reverted)."})

    hs = {h["file"]: h for h in hotspots(project_id, top=200)["hotspots"]}
    for f in files:
        h = hs.get(f)
        if h and h["reverts"] > 0:
            score += min(20, 7 * h["reverts"])
            reasons.append({"kind": "risky_file", "weight": min(20, 7 * h["reverts"]),
                            "text": f"Touches {f} — {h['reverts']} prior revert(s) here."})
        if h and h["bus_factor_risk"]:
            score += 10
            reasons.append({"kind": "bus_factor", "weight": 10,
                            "text": f"{f} has bus factor 1 (one author owns it)."})

    score = max(0, min(100, score))
    level = "LOW" if score < 30 else ("MEDIUM" if score < 60 else "HIGH")
    if not reasons:
        reasons.append({"kind": "clear", "weight": 0,
                        "text": "No prior reversions or risky hotspots matched."})
    return {"score": score, "level": level, "reasons": reasons}
