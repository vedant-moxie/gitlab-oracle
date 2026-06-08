"""Parse GitLab cross-references and reversions out of free text.

GitLab auto-links issues/MRs via keywords; we mine the same signals plus
reversion markers so we can build edges in the temporal knowledge graph.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# High-precision issue links only: keyword form ("Closes #12") or a full
# .../issues/123 URL. We deliberately DROP bare "#123" matching — in a big repo
# it produces false-positive citations (stray numbers in prose).
_ISSUE_RE = re.compile(r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|related to|see)\s+#(\d+)", re.I)
_ISSUE_URL_RE = re.compile(r"/issues/(\d+)")
# MR refs: "!123" shorthand OR a full .../merge_requests/123 URL.
_MR_RE = re.compile(r"(?<![\w])!(\d+)\b")
_MR_URL_RE = re.compile(r"/merge_requests/(\d+)")
_REVERT_RE = re.compile(r"\brevert(?:s|ed|ing)?\b", re.I)
# Reverted MR via shorthand or URL; reverted commit via "This reverts commit <sha>"
_REVERTED_MR_RE = re.compile(r"revert.*?(?:!(\d+)|/merge_requests/(\d+))", re.I | re.S)
_REVERTED_SHA_RE = re.compile(r"reverts commit\s+([0-9a-f]{7,40})", re.I)

# Words that signal a deliberate architectural decision worth surfacing later.
_DECISION_KEYWORDS = (
    "architecture", "decision", "refactor", "rework", "redesign", "migrate",
    "deprecat", "rollback", "rollout", "tradeoff", "trade-off", "rationale",
    "instead of", "switch to", "move away", "incident", "postmortem", "post-mortem",
)


@dataclass
class Relationships:
    linked_issues: list[int] = field(default_factory=list)
    linked_mrs: list[int] = field(default_factory=list)
    is_reversion: bool = False
    reverted_mr_id: int | None = None
    reverted_sha: str | None = None
    is_decision: bool = False

    def to_dict(self) -> dict:
        return {
            "linked_issues": self.linked_issues,
            "linked_mrs": self.linked_mrs,
            "is_reversion": self.is_reversion,
            "reverted_mr_id": self.reverted_mr_id,
            "reverted_sha": self.reverted_sha,
            "is_decision": self.is_decision,
        }


def parse(text: str | None) -> Relationships:
    rel = Relationships()
    if not text:
        return rel

    rel.linked_issues = sorted(
        {int(m) for m in _ISSUE_RE.findall(text)}
        | {int(m) for m in _ISSUE_URL_RE.findall(text)}
    )
    rel.linked_mrs = sorted(
        {int(m) for m in _MR_RE.findall(text)}
        | {int(m) for m in _MR_URL_RE.findall(text)}
    )

    if _REVERT_RE.search(text):
        rel.is_reversion = True
        if (m := _REVERTED_MR_RE.search(text)):
            rel.reverted_mr_id = int(m.group(1) or m.group(2))
        if (m := _REVERTED_SHA_RE.search(text)):
            rel.reverted_sha = m.group(1)

    low = text.lower()
    rel.is_decision = rel.is_reversion or any(kw in low for kw in _DECISION_KEYWORDS)
    return rel
