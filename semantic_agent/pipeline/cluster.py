"""Cluster: run K-means on market embeddings and persist cluster assignments."""

import logging
import os
from pathlib import Path

import numpy as np

# Disable Chroma telemetry before chromadb is imported (env var must be set early)
os.environ["ANONYMIZED_TELEMETRY"] = "FALSE"

from semantic_agent.models.market import Cluster
from semantic_agent.logging_utils import configure_logging

logger = logging.getLogger(__name__)

# Use MiniBatchKMeans when N exceeds this (much faster for large N)
_MINIBATCH_THRESHOLD = 5000


def run_cluster_and_store(
    database_url: str,
    *,
    collection_name: str | None = None,
    chroma_path: Path | None = None,
    cluster_ratio: float | None = None,
    max_clusters: int | None = None,
    random_state: int = 42,
) -> list[Cluster]:
    """
    Load market embeddings from ChromaDB, run K-means clustering,
    and persist cluster assignments to SQLite.
    Uses MiniBatchKMeans for large N for speed; caps K with max_clusters.
    Returns the list of Cluster models.
    """
    configure_logging()
    from sklearn.cluster import KMeans, MiniBatchKMeans

    from semantic_agent.config import get_settings
    from semantic_agent.store import read_markets, write_clusters

    settings = get_settings()
    collection_name = collection_name or settings.chroma_collection_name
    chroma_path = chroma_path or settings.chroma_persist_path
    cluster_ratio = cluster_ratio if cluster_ratio is not None else settings.cluster_ratio
    max_clusters = max_clusters if max_clusters is not None else settings.max_clusters

    markets = read_markets(database_url)
    if not markets:
        logger.warning("No markets to cluster")
        return []

    market_ids = [m.id for m in markets]
    chroma_path = Path(chroma_path).resolve()
    if not chroma_path.exists():
        logger.warning("Chroma path not found at %s; run embed first", chroma_path)
        return []

    import chromadb
    from chromadb.config import Settings as ChromaSettings

    client = chromadb.PersistentClient(
        path=str(chroma_path),
        settings=ChromaSettings(anonymized_telemetry=False),
    )
    try:
        collection = client.get_collection(name=collection_name)
    except Exception as e:
        logger.warning("Chroma collection %s not found: %s; run embed first", collection_name, e)
        return []

    # Get embeddings in same order as market_ids (Chroma returns in requested id order)
    result = collection.get(ids=market_ids, include=["embeddings"])
    ids_returned = result["ids"]
    embeddings = result["embeddings"]
    if not ids_returned or len(embeddings) == 0:
        logger.warning("No embeddings found in Chroma for collection %s", collection_name)
        return []

    n = len(ids_returned)
    k = max(1, min(int(n * cluster_ratio), max_clusters))
    if k > n:
        k = n
    use_minibatch = n >= _MINIBATCH_THRESHOLD
    logger.info(
        "Clustering %d markets into %d clusters (ratio=%.2f, max=%d)%s",
        n, k, cluster_ratio, max_clusters,
        " [MiniBatchKMeans]" if use_minibatch else "",
    )

    X = np.asarray(embeddings, dtype=np.float64)
    if use_minibatch:
        kmeans = MiniBatchKMeans(n_clusters=k, random_state=random_state, batch_size=1024, n_init=3)
    else:
        kmeans = KMeans(n_clusters=k, random_state=random_state, n_init=10)
    labels = kmeans.fit_predict(X)

    clusters: list[Cluster] = []
    log_every = max(1, k // 10)  # log every 10% of clusters
    for i in range(k):
        cluster_market_ids = [ids_returned[j] for j in range(n) if labels[j] == i]
        clusters.append(
            Cluster(
                cluster_id=f"c_{i}",
                market_ids=cluster_market_ids,
                category="other",
            )
        )
        if (i + 1) % log_every == 0 or i == 0:
            logger.info(
                "Built cluster c_%d (%d/%d clusters, %d markets)",
                i,
                i + 1,
                k,
                len(cluster_market_ids),
            )

    write_clusters(clusters, database_url)
    logger.info("Wrote %d clusters to %s", len(clusters), database_url)
    return clusters
