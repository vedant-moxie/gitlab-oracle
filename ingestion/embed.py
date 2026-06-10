"""Vertex AI text embeddings for ingestion (documents) and query time."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List

import vertexai
from vertexai.language_models import TextEmbeddingInput, TextEmbeddingModel

import config

_model: TextEmbeddingModel | None = None
_model_lock = threading.Lock()


def _get_model() -> TextEmbeddingModel:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                vertexai.init(project=config.PROJECT_ID, location=config.LOCATION)
                _model = TextEmbeddingModel.from_pretrained(config.EMBEDDING_MODEL)
    return _model


# text-embedding-005 caps a single request at 20k tokens total. We truncate each
# text and pack batches under a conservative token budget (chars/4 ≈ tokens).
_MAX_CHARS = 2000          # ~500 tokens per doc; full text still lives in Firestore
_TOKEN_BUDGET = 14000      # safety margin under the 20k hard limit
_MAX_BATCH = 16            # API also caps instances per request
_EMBED_WORKERS = 3         # concurrent embedding API calls (stay under rate limit)


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a batch of corpus texts (task_type RETRIEVAL_DOCUMENT).
    Sub-batches are dispatched concurrently for higher throughput."""
    model = _get_model()

    # Split into sub-batches first (preserving order)
    sub_batches: List[List[str]] = []
    batch: list[str] = []
    budget = 0
    for t in texts:
        t = (t or " ")[:_MAX_CHARS]
        est = max(1, len(t) // 4)
        if batch and (budget + est > _TOKEN_BUDGET or len(batch) >= _MAX_BATCH):
            sub_batches.append(batch)
            batch, budget = [], 0
        batch.append(t)
        budget += est
    if batch:
        sub_batches.append(batch)

    if not sub_batches:
        return []

    def _call(b: list[str]) -> list[list[float]]:
        inputs = [TextEmbeddingInput(text=t, task_type="RETRIEVAL_DOCUMENT") for t in b]
        embs = model.get_embeddings(inputs, output_dimensionality=config.EMBEDDING_DIM)
        return [e.values for e in embs]

    # Run sub-batches in parallel; collect results in original order
    results: list[list[list[float]] | None] = [None] * len(sub_batches)
    n_workers = min(_EMBED_WORKERS, len(sub_batches))
    with ThreadPoolExecutor(max_workers=n_workers) as pool:
        future_to_idx = {pool.submit(_call, b): i for i, b in enumerate(sub_batches)}
        from concurrent.futures import as_completed
        for fut in as_completed(future_to_idx):
            results[future_to_idx[fut]] = fut.result()

    out: list[list[float]] = []
    for r in results:
        if r:
            out.extend(r)
    return out


def _reset_model() -> None:
    """Drop the cached model so the next call builds a fresh gRPC channel
    (recovers from stale-channel '503 recvmsg: Operation timed out' errors
    in long-lived server processes)."""
    global _model
    with _model_lock:
        _model = None


def embed_query(text: str) -> list[float]:
    """Embed a single search query (task_type RETRIEVAL_QUERY)."""
    inputs = [TextEmbeddingInput(text=text[:8000] or " ", task_type="RETRIEVAL_QUERY")]
    try:
        model = _get_model()
        return model.get_embeddings(inputs, output_dimensionality=config.EMBEDDING_DIM)[0].values
    except Exception:
        # Stale channel — rebuild and retry once; second failure propagates.
        _reset_model()
        model = _get_model()
        return model.get_embeddings(inputs, output_dimensionality=config.EMBEDDING_DIM)[0].values
