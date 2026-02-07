"""Label: assign a category label to each cluster using an LLM."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from semantic_agent.logging_utils import configure_logging
from semantic_agent.models.market import Cluster
from semantic_agent.utils import retry_llm

logger = logging.getLogger(__name__)


DEFAULT_TAXONOMY: list[str] = [
    "politics",
    "macro",
    "finance",
    "crypto",
    "tech",
    "sports",
    "culture",
    "other",
]


def _safe_json_loads(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except Exception:
        return None


def label_single_cluster(
    questions: list[str],
    *,
    taxonomy: list[str] = DEFAULT_TAXONOMY,
    openai_api_key: str,
    openai_model: str,
    openai_api_base: str | None = None,
) -> tuple[str, str | None]:
    """Call OpenAI-compatible API to label one cluster. Returns (category, rationale)."""
    from openai import OpenAI

    client_kw: dict[str, str] = {"api_key": openai_api_key}
    if openai_api_base:
        client_kw["base_url"] = openai_api_base.rstrip("/")
    client = OpenAI(**client_kw)

    tax = ", ".join(taxonomy)
    q_block = "\n".join([f"- {q}" for q in questions if q.strip()][:200])

    system = (
        "You are labeling topical clusters of prediction market questions. "
        "Pick exactly one category from a fixed taxonomy."
    )
    user = (
        f"Taxonomy: [{tax}]\n\n"
        "Given the cluster questions below, return JSON with keys:\n"
        '- "category": one of the taxonomy values\n'
        '- "label_rationale": short reason (optional)\n\n'
        f"Cluster questions:\n{q_block}\n"
    )

    # Prefer structured JSON output when supported; retry on rate limit / server errors.
    def _create():
        try:
            return client.chat.completions.create(
                model=openai_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
        except TypeError:
            return client.chat.completions.create(
                model=openai_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0,
            )

    resp = retry_llm(_create, max_retries=3, base_delay=1.0)

    content = (resp.choices[0].message.content or "").strip()
    data = _safe_json_loads(content) or {}

    category = str(data.get("category", "other")).strip().lower()
    rationale = data.get("label_rationale")
    if rationale is not None:
        rationale = str(rationale).strip() or None

    if category not in taxonomy:
        category = "other"

    return category, rationale


def _label_one_cluster(
    c: Cluster,
    database_url: str,
    *,
    taxonomy: list[str],
    sample_size: int,
    openai_api_key: str,
    openai_model: str,
    openai_api_base: str | None,
) -> tuple[str, tuple[str, str | None]]:
    """
    Label one cluster (runs in worker thread).
    Returns (cluster_id, (category, rationale)).
    """
    from semantic_agent.store import read_markets_by_ids

    sample_ids = c.market_ids[:sample_size]
    markets = read_markets_by_ids(database_url, sample_ids)
    questions = [m.question for m in markets if m.question]
    if not questions:
        return (c.cluster_id, ("other", "No questions available for this cluster sample."))
    try:
        category, rationale = label_single_cluster(
            questions,
            taxonomy=taxonomy,
            openai_api_key=openai_api_key,
            openai_model=openai_model,
            openai_api_base=openai_api_base,
        )
        return (c.cluster_id, (category, rationale))
    except Exception as exc:
        logger.warning("Cluster %s: labeling failed (%s); using other", c.cluster_id, exc)
        return (c.cluster_id, ("other", str(exc)))


def run_label_clusters(
    database_url: str,
    *,
    taxonomy: list[str] = DEFAULT_TAXONOMY,
    max_clusters: int | None = None,
    sample_size: int | None = None,
    only_unlabeled: bool = True,
    parallel_workers: int | None = None,
) -> dict[str, tuple[str, str | None]]:
    """
    Label clusters in the DB and persist category/rationale.
    Uses parallel_workers (default from config) to label multiple clusters at once.
    Returns a dict of {cluster_id: (category, rationale)} for labeled clusters.
    """
    configure_logging()

    from semantic_agent.config import get_settings
    from semantic_agent.store import read_clusters, update_cluster_labels

    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("Missing VERIBOND_OPENAI_API_KEY (or openai_api_key in .env)")

    max_clusters = max_clusters if max_clusters is not None else settings.label_max_clusters
    sample_size = sample_size if sample_size is not None else settings.label_sample_size
    parallel_workers = (
        parallel_workers
        if parallel_workers is not None
        else getattr(settings, "label_parallel_workers", 5)
    )
    parallel_workers = max(1, min(parallel_workers, 20))

    clusters = read_clusters(database_url)
    if not clusters:
        logger.warning("No clusters found; run clustering first")
        return {}

    if only_unlabeled:
        clusters = [c for c in clusters if (c.category or "other") == "other"]

    clusters = clusters[:max_clusters]
    logger.info("Labeling %d clusters (sample_size=%d, workers=%d)", len(clusters), sample_size, parallel_workers)

    labels: dict[str, tuple[str, str | None]] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=parallel_workers) as executor:
        futures = {
            executor.submit(
                _label_one_cluster,
                c,
                database_url,
                taxonomy=taxonomy,
                sample_size=sample_size,
                openai_api_key=settings.openai_api_key,
                openai_model=settings.openai_model,
                openai_api_base=settings.openai_api_base,
            ): c
            for c in clusters
        }
        for future in as_completed(futures):
            c = futures[future]
            try:
                cluster_id, (category, rationale) = future.result()
                labels[cluster_id] = (category, rationale)
            except Exception as exc:
                logger.warning("Cluster %s: failed (%s)", c.cluster_id, exc)
                labels[c.cluster_id] = ("other", str(exc))
            done += 1
            if done == 1 or done % max(1, len(clusters) // 10) == 0 or done == len(clusters):
                logger.info("Labeled %d/%d clusters", done, len(clusters))

    update_cluster_labels(database_url, labels=labels)
    return labels

