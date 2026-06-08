"""Vertex AI text embeddings for ingestion (documents) and query time."""
from __future__ import annotations

import vertexai
from vertexai.language_models import TextEmbeddingInput, TextEmbeddingModel

import config

_model: TextEmbeddingModel | None = None


def _get_model() -> TextEmbeddingModel:
    global _model
    if _model is None:
        vertexai.init(project=config.PROJECT_ID, location=config.LOCATION)
        _model = TextEmbeddingModel.from_pretrained(config.EMBEDDING_MODEL)
    return _model


# text-embedding-005 caps a single request at 20k tokens total. We truncate each
# text and pack batches under a conservative token budget (chars/4 ≈ tokens).
_MAX_CHARS = 2000          # ~500 tokens per doc; full text still lives in Firestore
_TOKEN_BUDGET = 14000      # safety margin under the 20k hard limit
_MAX_BATCH = 16            # API also caps instances per request


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a batch of corpus texts (task_type RETRIEVAL_DOCUMENT)."""
    model = _get_model()
    out: list[list[float]] = []
    batch: list[str] = []
    budget = 0

    def _flush(b: list[str]):
        if not b:
            return
        inputs = [TextEmbeddingInput(text=t or " ", task_type="RETRIEVAL_DOCUMENT") for t in b]
        embs = model.get_embeddings(inputs, output_dimensionality=config.EMBEDDING_DIM)
        out.extend(e.values for e in embs)

    for t in texts:
        t = (t or " ")[:_MAX_CHARS]
        est = max(1, len(t) // 4)
        if batch and (budget + est > _TOKEN_BUDGET or len(batch) >= _MAX_BATCH):
            _flush(batch)
            batch, budget = [], 0
        batch.append(t)
        budget += est
    _flush(batch)
    return out


def embed_query(text: str) -> list[float]:
    """Embed a single search query (task_type RETRIEVAL_QUERY)."""
    model = _get_model()
    inputs = [TextEmbeddingInput(text=text[:8000] or " ", task_type="RETRIEVAL_QUERY")]
    return model.get_embeddings(inputs, output_dimensionality=config.EMBEDDING_DIM)[0].values
