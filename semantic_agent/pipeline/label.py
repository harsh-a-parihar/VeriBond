"""Label: assign a category label to each cluster using an LLM."""

from __future__ import annotations

import json
import logging
from typing import Any

from semantic_agent.logging_utils import configure_logging

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

    # Prefer structured JSON output when supported.
    try:
        resp = client.chat.completions.create(
            model=openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
    except TypeError:
        resp = client.chat.completions.create(
            model=openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0,
        )

    content = (resp.choices[0].message.content or "").strip()
    data = _safe_json_loads(content) or {}

    category = str(data.get("category", "other")).strip().lower()
    rationale = data.get("label_rationale")
    if rationale is not None:
        rationale = str(rationale).strip() or None

    if category not in taxonomy:
        category = "other"

    return category, rationale


def run_label_clusters(
    database_url: str,
    *,
    taxonomy: list[str] = DEFAULT_TAXONOMY,
    max_clusters: int | None = None,
    sample_size: int | None = None,
    only_unlabeled: bool = True,
) -> dict[str, tuple[str, str | None]]:
    """
    Label clusters in the DB and persist category/rationale.
    Returns a dict of {cluster_id: (category, rationale)} for labeled clusters.
    """
    configure_logging()

    from semantic_agent.config import get_settings
    from semantic_agent.store import read_clusters, read_markets_by_ids, update_cluster_labels

    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("Missing VERIBOND_OPENAI_API_KEY (or openai_api_key in .env)")

    max_clusters = max_clusters if max_clusters is not None else settings.label_max_clusters
    sample_size = sample_size if sample_size is not None else settings.label_sample_size

    clusters = read_clusters(database_url)
    if not clusters:
        logger.warning("No clusters found; run clustering first")
        return {}

    if only_unlabeled:
        clusters = [c for c in clusters if (c.category or "other") == "other"]

    clusters = clusters[:max_clusters]
    logger.info("Labeling %d clusters (sample_size=%d)", len(clusters), sample_size)

    labels: dict[str, tuple[str, str | None]] = {}
    for idx, c in enumerate(clusters, start=1):
        sample_ids = c.market_ids[:sample_size]
        markets = read_markets_by_ids(database_url, sample_ids)
        questions = [m.question for m in markets if m.question]
        if not questions:
            labels[c.cluster_id] = ("other", "No questions available for this cluster sample.")
            continue

        category, rationale = label_single_cluster(
            questions,
            taxonomy=taxonomy,
            openai_api_key=settings.openai_api_key,
            openai_model=settings.openai_model,
            openai_api_base=settings.openai_api_base,
        )
        labels[c.cluster_id] = (category, rationale)

        if idx == 1 or idx % max(1, len(clusters) // 10) == 0:
            logger.info("Labeled %d/%d clusters (latest=%s → %s)", idx, len(clusters), c.cluster_id, category)

    update_cluster_labels(database_url, labels=labels)
    return labels

