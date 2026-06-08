"""Thin wrapper over Vertex AI Vector Search (Matching Engine).

Ingestion calls `upsert()`; the agent's tools call `search()`.
Datapoint IDs are namespaced (`commit:<sha>`, `mr:<iid>`, ...) so a neighbor
result maps straight back to a Firestore document.
"""
from __future__ import annotations

from dataclasses import dataclass

from google.cloud import aiplatform
from google.cloud.aiplatform.matching_engine.matching_engine_index_endpoint import (
    Namespace,
)
from google.cloud.aiplatform_v1.types import IndexDatapoint

import config

_index: aiplatform.MatchingEngineIndex | None = None
_endpoint: aiplatform.MatchingEngineIndexEndpoint | None = None


def _get_index() -> aiplatform.MatchingEngineIndex:
    global _index
    if _index is None:
        aiplatform.init(project=config.PROJECT_ID, location=config.LOCATION)
        _index = aiplatform.MatchingEngineIndex(index_name=config.VECTOR_INDEX_ID)
    return _index


def _get_endpoint() -> aiplatform.MatchingEngineIndexEndpoint:
    global _endpoint
    if _endpoint is None:
        aiplatform.init(project=config.PROJECT_ID, location=config.LOCATION)
        _endpoint = aiplatform.MatchingEngineIndexEndpoint(
            index_endpoint_name=config.VECTOR_INDEX_ENDPOINT_ID
        )
    return _endpoint


@dataclass
class Datapoint:
    id: str  # e.g. "commit:abc123"
    vector: list[float]
    node_type: str  # commit | mr | issue | decision
    files: list[str] | None = None  # for file_path filtering


def upsert(points: list[Datapoint]) -> None:
    """Stream-upsert datapoints. Requires the index to be STREAM_UPDATE."""
    if not points:
        return
    dps = []
    for p in points:
        restricts = [IndexDatapoint.Restriction(namespace="type", allow_list=[p.node_type])]
        if p.files:
            # cap to keep datapoint small; enables file_path-scoped search
            restricts.append(
                IndexDatapoint.Restriction(namespace="file", allow_list=p.files[:50])
            )
        dps.append(
            IndexDatapoint(datapoint_id=p.id, feature_vector=p.vector, restricts=restricts)
        )
    index = _get_index()
    # upsert in batches (API limit ~1000/req; stay well under)
    for i in range(0, len(dps), 200):
        index.upsert_datapoints(datapoints=dps[i : i + 200])


def search(
    query_vector: list[float],
    k: int = 8,
    node_types: list[str] | None = None,
    file_path: str | None = None,
) -> list[tuple[str, float]]:
    """Return [(datapoint_id, distance), ...] nearest neighbors."""
    filters = []
    if node_types:
        filters.append(Namespace("type", list(node_types), []))
    if file_path:
        filters.append(Namespace("file", [file_path], []))
    endpoint = _get_endpoint()
    resp = endpoint.find_neighbors(
        deployed_index_id=config.VECTOR_DEPLOYED_INDEX_ID,
        queries=[query_vector],
        num_neighbors=k,
        filter=filters or None,
    )
    if not resp or not resp[0]:
        return []
    return [(n.id, n.distance) for n in resp[0]]
