"""Pipeline agents: ingest, embed, cluster, label, relationship discovery, evaluate."""

from semantic_agent.pipeline.label import run_label_clusters
from semantic_agent.pipeline.relations import run_discover_relations


def __getattr__(name: str):
    """Lazy load modules on first use (avoids pulling pandas/embed/cluster when only running eval)."""
    if name in ("load_from_csv_and_save", "load_markets_from_csv"):
        from semantic_agent.pipeline.ingest import load_from_csv_and_save, load_markets_from_csv
        return load_from_csv_and_save if name == "load_from_csv_and_save" else load_markets_from_csv
    if name == "run_cluster_and_store":
        from semantic_agent.pipeline.cluster import run_cluster_and_store
        return run_cluster_and_store
    if name == "run_embed_and_store":
        from semantic_agent.pipeline.embed import run_embed_and_store
        return run_embed_and_store
    if name in ("run_evaluate_relations", "EvalResult"):
        from semantic_agent.pipeline.evaluate import EvalResult, run_evaluate_relations
        return EvalResult if name == "EvalResult" else run_evaluate_relations
    if name == "run_reset":
        from semantic_agent.pipeline.reset import run_reset
        return run_reset
    if name == "run_full_pipeline":
        from semantic_agent.pipeline.run_full import run_full_pipeline
        return run_full_pipeline
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "load_markets_from_csv",
    "load_from_csv_and_save",
    "run_embed_and_store",
    "run_cluster_and_store",
    "run_label_clusters",
    "run_discover_relations",
    "run_evaluate_relations",
    "run_reset",
    "run_full_pipeline",
    "EvalResult",
]
