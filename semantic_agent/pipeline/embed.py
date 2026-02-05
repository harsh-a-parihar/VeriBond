"""Embed: generate market embeddings and persist to ChromaDB."""

import logging
import os
from pathlib import Path

from semantic_agent.models.market import Market
from semantic_agent.logging_utils import configure_logging

# Disable Chroma telemetry before chromadb is imported (env var must be set early)
os.environ["ANONYMIZED_TELEMETRY"] = "FALSE"

logger = logging.getLogger(__name__)


def build_market_text(market: Market) -> str:
    """Build a single text string from market question and optional description."""
    parts = [market.question.strip()]
    if market.description and market.description.strip():
        parts.append(market.description.strip())
    return " ".join(parts)


def embed_markets(
    markets: list[Market],
    model_name: str,
    batch_size: int = 64,
) -> list[list[float]]:
    """
    Embed market texts using sentence-transformers.
    Returns list of embedding vectors in same order as markets.
    """
    from sentence_transformers import SentenceTransformer

    texts = [build_market_text(m) for m in markets]
    model = SentenceTransformer(model_name)
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=len(texts) > 100,
        normalize_embeddings=False,
    )
    return [emb.tolist() for emb in embeddings]


def run_embed_and_store(
    database_url: str,
    *,
    collection_name: str | None = None,
    chroma_path: Path | None = None,
    model_name: str | None = None,
    batch_size: int | None = None,
) -> int:
    """
    Load markets from SQLite, embed them, and persist to ChromaDB.
    Uses settings for defaults when arguments are None.
    Returns the number of markets embedded and stored.
    """
    configure_logging()
    from semantic_agent.config import get_settings
    from semantic_agent.store import read_markets

    settings = get_settings()
    collection_name = collection_name or settings.chroma_collection_name
    chroma_path = chroma_path or settings.chroma_persist_path
    model_name = model_name or settings.embedding_model
    batch_size = batch_size or settings.embed_batch_size

    markets = read_markets(database_url)
    if not markets:
        logger.warning("No markets to embed")
        return 0

    chroma_path = Path(chroma_path).resolve()
    chroma_path.mkdir(parents=True, exist_ok=True)

    import chromadb
    from chromadb.config import Settings as ChromaSettings

    client = chromadb.PersistentClient(
        path=str(chroma_path),
        settings=ChromaSettings(anonymized_telemetry=False),
    )
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"description": "Market embeddings for semantic search and clustering"},
    )

    # Embed in batches and add to Chroma (Chroma accepts batches)
    ids: list[str] = []
    documents: list[str] = []
    all_embeddings: list[list[float]] = []

    embeddings = embed_markets(markets, model_name=model_name, batch_size=batch_size)
    ids = [m.id for m in markets]
    documents = [build_market_text(m) for m in markets]
    all_embeddings = embeddings

    # Add in chunks to avoid huge single requests
    add_batch_size = min(500, batch_size * 4)
    for i in range(0, len(ids), add_batch_size):
        chunk_ids = ids[i : i + add_batch_size]
        chunk_docs = documents[i : i + add_batch_size]
        chunk_embeddings = all_embeddings[i : i + add_batch_size]
        collection.upsert(
            ids=chunk_ids,
            documents=chunk_docs,
            embeddings=chunk_embeddings,
        )
    logger.info("Embedded and stored %d markets in Chroma at %s", len(markets), chroma_path)
    return len(markets)
