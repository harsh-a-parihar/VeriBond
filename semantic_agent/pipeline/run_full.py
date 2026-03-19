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
    use_all_sources: bool = True,
    gamma_max_pages: int | None = 300,
):
    """
    Reset, ingest (Gamma + CSV or CSV only), embed, cluster, label, relations, evaluate.

    use_all_sources: if True (default), use load_from_all_sources (Gamma API + optional CSV).
                     if False, use load_from_csv_and_save (CSV only).
    csv_path: for all_sources = path to CSV to merge (optional); for CSV-only = path to load.
    nrows: only for CSV-only; max CSV rows. None = no limit.
    gamma_max_pages: only for all_sources; max Gamma API pages (default 300).
    """
    configure_logging()
    from semantic_agent.config import get_settings
    from semantic_agent.pipeline.ingest import load_from_all_sources, load_from_csv_and_save
    from semantic_agent.pipeline.reset import run_reset
    from semantic_agent.pipeline.embed import run_embed_and_store
    from semantic_agent.pipeline.cluster import run_cluster_and_store
    from semantic_agent.pipeline.label import run_label_clusters
    from semantic_agent.pipeline.relations import run_discover_relations
    from semantic_agent.pipeline.evaluate import run_evaluate_relations

    settings = get_settings()
    db_url = database_url or settings.database_url
    min_days = min_duration_days if min_duration_days is not None else settings.min_duration_days

    logger.info("=== Full pipeline (use_all_sources=%s) ===", use_all_sources)
    result = None

    try:
        logger.info("Reset derived data and Chroma...")
        run_reset(db_url)
    except Exception as exc:
        logger.warning("Pipeline step [reset] failed: %s; continuing", exc)

    try:
        if use_all_sources:
            csv_path_resolved = Path(csv_path) if csv_path else (settings.raw_data_path / DEFAULT_CSV_FILENAME)
            if not csv_path_resolved.exists():
                csv_path_resolved = None  # Gamma only if CSV missing
            markets = load_from_all_sources(
                db_url,
                csv_path=csv_path_resolved,
                use_gamma=True,
                min_duration_days=min_days,
                require_resolved=require_resolved,
                require_binary=require_binary,
                csv_nrows=nrows,
                gamma_max_pages=gamma_max_pages or 300,
            )
            logger.info("Ingested %d markets (Gamma + CSV)", len(markets))
        else:
            csv_path_resolved = Path(csv_path or settings.raw_data_path / DEFAULT_CSV_FILENAME)
            if not csv_path_resolved.exists():
                raise FileNotFoundError(f"CSV not found: {csv_path_resolved}. Set csv_path or add {DEFAULT_CSV_FILENAME} to data/raw.")
            markets = load_from_csv_and_save(
                csv_path_resolved,
                db_url,
                source_label="csv",
                min_duration_days=min_days,
                require_resolved=require_resolved,
                require_binary=require_binary,
                nrows=nrows,
            )
            logger.info("Ingested %d markets (CSV only)", len(markets))
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
