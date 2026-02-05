"""Reset: clear Chroma collection and derived SQLite data for a fresh pipeline run."""

import logging
import os
from pathlib import Path

from semantic_agent.logging_utils import configure_logging

# Disable Chroma telemetry before chromadb is imported
os.environ["ANONYMIZED_TELEMETRY"] = "FALSE"

logger = logging.getLogger(__name__)


def run_reset(
    database_url: str,
    *,
    collection_name: str | None = None,
    chroma_path: Path | None = None,
) -> None:
    """
    Clear Chroma collection and SQLite derived data (clusters, market_clusters, relations).
    Markets table is left unchanged. Run this before a full re-run so that:
    - Embed writes into an empty collection (no stale IDs).
    - Cluster/label/relations see only new data.
    """
    configure_logging()
    from semantic_agent.config import get_settings
    from semantic_agent.store import clear_derived_data

    settings = get_settings()
    collection_name = collection_name or settings.chroma_collection_name
    chroma_path = chroma_path or settings.chroma_persist_path

    clear_derived_data(database_url)

    chroma_path = Path(chroma_path).resolve()
    if chroma_path.exists():
        import chromadb
        from chromadb.config import Settings as ChromaSettings

        client = chromadb.PersistentClient(
            path=str(chroma_path),
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        try:
            client.delete_collection(name=collection_name)
            logger.info("Deleted Chroma collection %s at %s", collection_name, chroma_path)
        except Exception as e:
            logger.warning("Chroma collection %s not found or already deleted: %s", collection_name, e)
    else:
        logger.info("Chroma path %s does not exist; nothing to clear", chroma_path)
