from __future__ import annotations

"""Thin wrapper over Vertex AI Vector Search (Matching Engine).

Ingestion calls `upsert()`; the agent's tools call `search()`.
Datapoint IDs are namespaced (`commit:<sha>`, `mr:<iid>`, ...) so a neighbor
result maps straight back to a Firestore document.
"""

import os
import threading
import certifi
os.environ['GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'] = certifi.where()

from dataclasses import dataclass

from google.cloud import aiplatform
from google.cloud.aiplatform.matching_engine.matching_engine_index_endpoint import (
    Namespace,
)
from google.cloud.aiplatform_v1.types import IndexDatapoint

import config

_index: aiplatform.MatchingEngineIndex | None = None
_endpoint: aiplatform.MatchingEngineIndexEndpoint | None = None
_lock = threading.Lock()

def _get_index() -> aiplatform.MatchingEngineIndex:
    global _index
    if _index is None:
        with _lock:
            if _index is None:
                aiplatform.init(project=config.PROJECT_ID, location=config.LOCATION)
                _index = aiplatform.MatchingEngineIndex(index_name=config.VECTOR_INDEX_ID)
    return _index

def _get_endpoint() -> aiplatform.MatchingEngineIndexEndpoint:
    global _endpoint
    if _endpoint is None:
        with _lock:
            if _endpoint is None:
                aiplatform.init(project=config.PROJECT_ID, location=config.LOCATION)
                _endpoint = aiplatform.MatchingEngineIndexEndpoint(
                    index_endpoint_name=config.VECTOR_INDEX_ENDPOINT_ID
                )
    return _endpoint

def warmup() -> None:
    """Pre-initialise both singletons in the calling thread so parallel workers
    don't race to init them simultaneously."""
    _get_index()
    _get_endpoint()

@dataclass
class Datapoint:
    id: str  # e.g. "commit:abc123"
    vector: list[float]
    node_type: str  # commit | mr | issue | decision
    project_id: str # Multi-tenant isolation
    files: list[str] | None = None  # for file_path filtering

def upsert(points: list[Datapoint]) -> None:
    """Stream-upsert datapoints. Requires the index to be STREAM_UPDATE."""
    if not points:
        return
    dps = []
    for p in points:
        restricts = [
            IndexDatapoint.Restriction(namespace="type", allow_list=[p.node_type]),
            IndexDatapoint.Restriction(namespace="project", allow_list=[p.project_id])
        ]
        if p.files:
            # cap to keep datapoint small; enables file_path-scoped search
            restricts.append(
                IndexDatapoint.Restriction(namespace="file", allow_list=p.files[:50])
            )
        dps.append(
            IndexDatapoint(datapoint_id=f"{p.project_id}:{p.id}", feature_vector=p.vector, restricts=restricts)
        )
    index = _get_index()
    # upsert in batches (API limit ~1000/req; stay well under).
    # Wrap each call in a thread + timeout — upsert_datapoints can hang
    # indefinitely on a stale gRPC connection; 90s is far more than enough.
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
    for i in range(0, len(dps), 200):
        batch = dps[i : i + 200]
        with ThreadPoolExecutor(max_workers=1) as _pool:
            fut = _pool.submit(index.upsert_datapoints, datapoints=batch)
            try:
                fut.result(timeout=90)
            except FutureTimeout:
                print(f"   ⚠️  Vector Search upsert timed out for batch {i//200 + 1}; skipping batch (data is in Firestore).")
            except Exception as e:
                print(f"   ⚠️  Vector Search upsert error: {e}; skipping batch.")

def search(
    query_vector: list[float],
    project_id: str,
    k: int = 8,
    node_types: list[str] | None = None,
    file_path: str | None = None,
) -> list[tuple[str, float]]:
    """Return [(datapoint_id, distance), ...] nearest neighbors."""
    # The original single-tenant ingest predates the "project" restrict and the
    # project-prefixed datapoint ids — filtering on it would exclude everything.
    legacy = project_id == config.GITLAB_UPSTREAM_PROJECT
    filters = [] if legacy else [Namespace("project", [project_id], [])]
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
    # New-layout ids are "<project_id>:<kind>:<id>"; legacy ids are "<kind>:<id>".
    # Strip only an actual project prefix so legacy ids keep their kind.
    prefix = f"{project_id}:"
    return [
        (n.id[len(prefix):] if n.id.startswith(prefix) else n.id, n.distance)
        for n in resp[0]
    ]
