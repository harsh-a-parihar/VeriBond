"""Run full pipeline from ingest through evaluation on whole data."""

import logging
from pathlib import Path

from semantic_agent.logging_utils import configure_logging

logger = logging.getLogger(__name__)

# Default CSV filename for Polymarket Kaggle export
DEFAULT_CSV_FILENAME = "polymarket_markets.csv"


def run_full_pipeline(
    *,
    csv_path: Path | str | None = None,
    database_url: str | None = None,
    min_duration_days: float | None = None,
    require_resolved: bool = False,
    require_binary: bool = True,
    nrows: int | None = None,
):
    """
    Reset, ingest (full CSV), embed, cluster, label, relations, evaluate.

    Uses config for paths and settings when arguments are None.
    csv_path: defaults to raw_data_path / polymarket_markets.csv.
    nrows: if set, only load this many CSV rows (for large files or testing).
           None = no limit (whole file); very large CSVs may need more RAM.
    """
    configure_logging()
    from semantic_agent.config import get_settings
    from semantic_agent.pipeline.ingest import load_from_csv_and_save
    from semantic_agent.pipeline.reset import run_reset
    from semantic_agent.pipeline.embed import run_embed_and_store
    from semantic_agent.pipeline.cluster import run_cluster_and_store
    from semantic_agent.pipeline.label import run_label_clusters
    from semantic_agent.pipeline.relations import run_discover_relations
    from semantic_agent.pipeline.evaluate import run_evaluate_relations

    settings = get_settings()
    db_url = database_url or settings.database_url
    if csv_path is None:
        csv_path = settings.raw_data_path / DEFAULT_CSV_FILENAME
    csv_path = Path(csv_path)
    min_days = min_duration_days if min_duration_days is not None else settings.min_duration_days

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}. Set csv_path or add {DEFAULT_CSV_FILENAME} to data/raw.")

    logger.info("=== Full pipeline (whole data) ===")
    result = None

    try:
        logger.info("Reset derived data and Chroma...")
        run_reset(db_url)
    except Exception as exc:
        logger.warning("Pipeline step [reset] failed: %s; continuing", exc)

    try:
        logger.info("Ingest from %s (nrows=%s)...", csv_path, nrows)
        markets = load_from_csv_and_save(
            csv_path,
            db_url,
            source_label="csv",
            min_duration_days=min_days,
            require_resolved=require_resolved,
            require_binary=require_binary,
            nrows=nrows,
        )
        logger.info("Ingested %d markets", len(markets))
    except Exception as exc:
        logger.warning("Pipeline step [ingest] failed: %s; continuing", exc)
        markets = []

    try:
        logger.info("Embed...")
        n_embed = run_embed_and_store(db_url)
        logger.info("Embedded %d markets", n_embed)
    except Exception as exc:
        logger.warning("Pipeline step [embed] failed: %s; continuing", exc)

    try:
        logger.info("Cluster...")
        clusters = run_cluster_and_store(db_url)
        logger.info("Clustered into %d clusters", len(clusters))
    except Exception as exc:
        logger.warning("Pipeline step [cluster] failed: %s; continuing", exc)
        clusters = []

    try:
        logger.info("Label...")
        run_label_clusters(db_url)
    except Exception as exc:
        logger.warning("Pipeline step [label] failed: %s; continuing", exc)

    try:
        logger.info("Discover relations...")
        run_discover_relations(db_url, skip_clusters_with_relations=True)
    except Exception as exc:
        logger.warning("Pipeline step [relations] failed: %s; continuing", exc)

    try:
        logger.info("Evaluate...")
        result = run_evaluate_relations(db_url)
        logger.info(
            "Eval: %d evaluable, accuracy=%.3f",
            result.total_evaluable,
            result.accuracy,
        )
    except Exception as exc:
        logger.warning("Pipeline step [evaluate] failed: %s", exc)

    if result is None:
        from semantic_agent.pipeline.evaluate import EvalResult
        result = EvalResult()
    return result


if __name__ == "__main__":
    run_full_pipeline()
