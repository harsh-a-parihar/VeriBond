"""Embed: generate market embeddings and persist to ChromaDB."""

import hashlib
import logging
import os
import re
import time
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


def text_hash(text: str) -> str:
    """SHA256 hash of text for cache key (stable across runs)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def embed_markets_local(
    markets: list[Market],
    model_name: str,
    batch_size: int = 64,
) -> list[list[float]]:
    """
    Embed market texts using sentence-transformers (local).
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


def _parse_retry_after_seconds(error: Exception) -> float | None:
    """Parse 'try again in Xms' or 'retry_after' from OpenAI rate-limit error. Returns seconds."""
    msg = str(error).lower()
    # e.g. "Please try again in 526ms"
    m = re.search(r"try again in (\d+)\s*ms", msg)
    if m:
        return max(1.0, int(m.group(1)) / 1000.0)
    m = re.search(r"retry[_\s]?after[:\s]+(\d+)", msg, re.I)
    if m:
        return max(1.0, float(m.group(1)))
    return None


def embed_markets_openai(
    markets: list[Market],
    model_name: str,
    api_key: str,
    api_base: str | None = None,
    batch_size: int = 100,
    delay_between_batches_seconds: float = 0.0,
    max_retries_429: int = 8,
) -> list[list[float]]:
    """
    Embed market texts using OpenAI Embeddings API.
    Returns list of embedding vectors in same order as markets.
    Batches requests (max batch_size texts per API call).
    On 429 rate limit: retries the same batch with backoff (and optional retry_after from error).
    """
    from openai import OpenAI

    texts = [build_market_text(m) for m in markets]
    client_kw: dict = {"api_key": api_key}
    if api_base:
        client_kw["base_url"] = api_base.rstrip("/")
    client = OpenAI(**client_kw)

    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        last_error: Exception | None = None
        for attempt in range(max_retries_429 + 1):
            try:
                resp = client.embeddings.create(model=model_name, input=chunk)
                chunk_emb = [d.embedding for d in sorted(resp.data, key=lambda x: x.index)]
                all_embeddings.extend(chunk_emb)
                break
            except Exception as e:
                last_error = e
                is_429 = (
                    getattr(e, "status_code", None) == 429
                    or "429" in str(e)
                    or "rate_limit" in str(e).lower()
                )
                if is_429 and attempt < max_retries_429:
                    wait = _parse_retry_after_seconds(e) or (30.0 * (2**min(attempt, 4)))
                    wait = min(wait, 120.0)
                    logger.warning(
                        "OpenAI embed rate limit (429), waiting %.1fs then retry %d/%d for batch at %d/%d",
                        wait,
                        attempt + 1,
                        max_retries_429,
                        i,
                        len(texts),
                    )
                    time.sleep(wait)
                else:
                    raise
        done = min(i + batch_size, len(texts))
        if len(texts) > batch_size and (done % 1000 == 0 or done == len(texts)):
            logger.info("OpenAI embed: %d/%d texts (%.1f%%)", done, len(texts), 100.0 * done / len(texts))
        if delay_between_batches_seconds > 0 and i + batch_size < len(texts):
            time.sleep(delay_between_batches_seconds)
    return all_embeddings


def embed_markets(
    markets: list[Market],
    model_name: str,
    batch_size: int = 64,
) -> list[list[float]]:
    """
    Embed market texts using sentence-transformers (local).
    Kept for backward compatibility; prefer embed_markets_local or run_embed_and_store with provider.
    """
    return embed_markets_local(markets, model_name=model_name, batch_size=batch_size)


def run_embed_and_store(
    database_url: str,
    *,
    collection_name: str | None = None,
    chroma_path: Path | None = None,
    model_name: str | None = None,
    batch_size: int | None = None,
) -> int:
    """
    Load markets from SQLite, embed them (local or OpenAI per config), and persist to ChromaDB.
    When provider=openai and cache enabled, uses embedding_cache to avoid re-calling API.
    Uses settings for defaults when arguments are None.
    Returns the number of markets embedded and stored.
    """
    configure_logging()
    from semantic_agent.config import get_settings
    from semantic_agent.store import get_cached_embeddings, read_markets, set_cached_embeddings

    settings = get_settings()
    provider = (getattr(settings, "embedding_provider", None) or "local").strip().lower()
    collection_name = collection_name or settings.chroma_collection_name
    chroma_path = chroma_path or settings.chroma_persist_path
    model_name = model_name or settings.embedding_model
    batch_size = batch_size or settings.embed_batch_size
    cache_enabled = getattr(settings, "embedding_cache_enabled", True)
    openai_batch = getattr(settings, "embedding_openai_batch_size", 100)
    openai_delay = getattr(settings, "embedding_openai_delay_between_batches_seconds", 0.5)
    openai_max_retries_429 = getattr(settings, "embedding_openai_max_retries_429", 8)

    markets = read_markets(database_url)
    if not markets:
        logger.warning("No markets to embed")
        return 0

    ids = [m.id for m in markets]
    documents = [build_market_text(m) for m in markets]
    all_embeddings: list[list[float]]

    if provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("VERIBOND_OPENAI_API_KEY required when embedding_provider=openai")
        # Build cache keys (market_id, text_hash)
        keys = [(m.id, text_hash(build_market_text(m))) for m in markets]
        cached: dict[tuple[str, str], list[float]] = {}
        if cache_enabled:
            cached = get_cached_embeddings(database_url, "openai", model_name, keys)
        to_embed_idx: list[int] = [i for i, m in enumerate(markets) if (m.id, keys[i][1]) not in cached]
        to_embed_markets = [markets[i] for i in to_embed_idx]

        if to_embed_markets:
            new_embeddings = embed_markets_openai(
                to_embed_markets,
                model_name=model_name,
                api_key=settings.openai_api_key,
                api_base=settings.openai_api_base,
                batch_size=openai_batch,
                delay_between_batches_seconds=openai_delay,
                max_retries_429=openai_max_retries_429,
            )
            if cache_enabled:
                new_entries = [
                    (markets[to_embed_idx[j]].id, keys[to_embed_idx[j]][1], new_embeddings[j])
                    for j in range(len(to_embed_markets))
                ]
                set_cached_embeddings(database_url, "openai", model_name, new_entries)
            for j, idx in enumerate(to_embed_idx):
                cached[(markets[idx].id, keys[idx][1])] = new_embeddings[j]

        all_embeddings = [cached[(m.id, keys[i][1])] for i, m in enumerate(markets)]
        if to_embed_markets:
            logger.info(
                "OpenAI embed: %d from cache, %d new (total %d)",
                len(markets) - len(to_embed_markets),
                len(to_embed_markets),
                len(markets),
            )
    else:
        embeddings = embed_markets_local(markets, model_name=model_name, batch_size=batch_size)
        all_embeddings = embeddings

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

    add_batch_size = 1000 if len(ids) > 5000 else min(500, batch_size * 4)
    for i in range(0, len(ids), add_batch_size):
        chunk_ids = ids[i : i + add_batch_size]
        chunk_docs = documents[i : i + add_batch_size]
        chunk_embeddings = all_embeddings[i : i + add_batch_size]
        collection.upsert(
            ids=chunk_ids,
            documents=chunk_docs,
            embeddings=chunk_embeddings,
        )
    logger.info("Embedded and stored %d markets in Chroma at %s (%s)", len(markets), chroma_path, provider)
    return len(markets)
