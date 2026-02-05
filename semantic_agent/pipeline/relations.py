"""Relationship discovery: LLM-predicted relations between markets within clusters."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from semantic_agent.logging_utils import configure_logging
from semantic_agent.models.market import Cluster, Market, MarketRelation, MarketRelationList

logger = logging.getLogger(__name__)


def _safe_json_loads(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except Exception:
        return None


def discover_relations_for_cluster(
    cluster: Cluster,
    markets: list[Market],
    *,
    openai_api_key: str,
    openai_model: str,
    openai_api_base: str | None = None,
    taxonomy_hint: str | None = None,
    max_relations: int = 60,
) -> list[MarketRelation]:
    """Call LLM once to propose relations within a single cluster."""
    from openai import OpenAI

    if len(markets) < 2:
        return []

    client_kw: dict[str, str] = {"api_key": openai_api_key}
    if openai_api_base:
        client_kw["base_url"] = openai_api_base.rstrip("/")
    client = OpenAI(**client_kw)

    # Build compact description of markets in this cluster
    lines: list[str] = []
    for m in markets:
        outcome = m.resolved_outcome or "UNKNOWN"
        lines.append(f"- [{m.id}] ({outcome}) {m.question}")
    markets_block = "\n".join(lines)

    system = (
        "You analyze prediction market questions and find pairs whose outcomes "
        "are semantically related. You must follow the JSON schema exactly."
    )

    taxonomy_line = f"Cluster category hint: {taxonomy_hint}.\n" if taxonomy_hint else ""

    user = (
        taxonomy_line
        + "Each line below is a market in the same topical cluster:\n"
        + markets_block
        + "\n\n"
        "Your task:\n"
        f"- Propose up to {max_relations} pairs of markets whose outcomes are related.\n"
        "- For each pair, decide if they tend to resolve to the SAME outcome (both YES/YES or NO/NO)\n"
        "  or to OPPOSITE outcomes (one YES, one NO).\n"
        "- Use a confidence score in [0,1].\n\n"
        "Return a JSON object with key 'relations' that matches this schema:\n"
        "{\n"
        '  \"relations\": [\n'
        "    {\n"
        '      \"market_id_i\": \"...\",\n'
        '      \"market_id_j\": \"...\",\n'
        '      \"question_i\": \"...\",   // verbatim question text for i\n'
        '      \"question_j\": \"...\",   // verbatim question text for j\n'
        '      \"is_same_outcome\": true, // true = SAME (YES/YES or NO/NO), false = OPPOSITE\n'
        '      \"confidence_score\": 0.0, // float in [0,1]\n'
        '      \"rationale\": \"...\"     // short reason\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )

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

    # Parse into MarketRelationList
    data = _safe_json_loads(content)
    if not isinstance(data, dict):
        logger.warning("Cluster %s: invalid JSON from LLM; skipping", cluster.cluster_id)
        return []

    try:
        mr_list = MarketRelationList.model_validate(data)
    except Exception as exc:  # pydantic validation error
        logger.warning("Cluster %s: failed to validate MarketRelationList: %s", cluster.cluster_id, exc)
        return []

    # Optionally trim to max_relations
    if len(mr_list.relations) > max_relations:
        mr_list.relations = mr_list.relations[:max_relations]

    return mr_list.relations


def _process_one_cluster(
    c: Cluster,
    m_list: list[Market],
    *,
    openai_api_key: str,
    openai_model: str,
    openai_api_base: str | None,
    max_relations_per_cluster: int,
) -> tuple[str, list[MarketRelation] | None]:
    """
    Discover relations for one cluster (runs in worker thread).
    Returns (cluster_id, relations) or (cluster_id, None) on error.
    """
    try:
        relations = discover_relations_for_cluster(
            c,
            m_list,
            openai_api_key=openai_api_key,
            openai_model=openai_model,
            openai_api_base=openai_api_base,
            taxonomy_hint=c.category if c.category != "other" else None,
            max_relations=max_relations_per_cluster,
        )
        return (c.cluster_id, relations)
    except Exception as exc:
        logger.warning("Cluster %s: discovery failed (%s); skipping", c.cluster_id, exc)
        return (c.cluster_id, None)


def run_discover_relations(
    database_url: str,
    *,
    max_clusters: int | None = None,
    max_markets_per_cluster: int | None = None,
    max_relations_per_cluster: int | None = None,
    only_labeled: bool = True,
    only_resolved: bool = False,
    skip_clusters_with_relations: bool = False,
    parallel_workers: int | None = None,
) -> dict[str, int]:
    """
    Run relationship discovery over clusters and persist results.

    When skip_clusters_with_relations=True, clusters that already have relations
    in the DB are skipped (useful when resuming after a partial run).
    Uses parallel_workers (default from config) to process multiple clusters at once.

    Returns a mapping {cluster_id: num_relations_written}.
    """
    configure_logging()

    from semantic_agent.config import get_settings
    from semantic_agent.store import (
        get_cluster_ids_with_relations,
        read_clusters,
        read_markets,
        write_relations_for_cluster,
    )

    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("Missing VERIBOND_OPENAI_API_KEY (or openai_api_key in .env)")

    max_clusters = max_clusters if max_clusters is not None else settings.relations_max_clusters
    max_markets_per_cluster = (
        max_markets_per_cluster
        if max_markets_per_cluster is not None
        else settings.relations_max_markets_per_cluster
    )
    max_relations_per_cluster = (
        max_relations_per_cluster
        if max_relations_per_cluster is not None
        else settings.relations_max_relations_per_cluster
    )
    parallel_workers = (
        parallel_workers
        if parallel_workers is not None
        else getattr(settings, "relations_parallel_workers", 5)
    )
    parallel_workers = max(1, min(parallel_workers, 20))

    clusters = read_clusters(database_url)
    if not clusters:
        logger.warning("No clusters found; run clustering first")
        return {}

    if only_labeled:
        clusters = [c for c in clusters if c.category and c.category != "other"]

    if skip_clusters_with_relations:
        done_ids = get_cluster_ids_with_relations(database_url)
        before = len(clusters)
        clusters = [c for c in clusters if c.cluster_id not in done_ids]
        skipped = before - len(clusters)
        if skipped:
            logger.info("Skipping %d clusters that already have relations", skipped)

    clusters = clusters[:max_clusters]

    all_markets = read_markets(database_url)
    markets_by_id: dict[str, Market] = {m.id: m for m in all_markets}

    # Build (cluster, market_list) for each cluster that has enough markets
    tasks: list[tuple[Cluster, list[Market]]] = []
    for c in clusters:
        m_list: list[Market] = []
        for mid in c.market_ids:
            m = markets_by_id.get(mid)
            if not m:
                continue
            if only_resolved and m.resolved_outcome not in ("YES", "NO"):
                continue
            m_list.append(m)
        if len(m_list) < 2:
            logger.debug("Cluster %s skipped (not enough markets)", c.cluster_id)
            continue
        if len(m_list) > max_markets_per_cluster:
            m_list = m_list[:max_markets_per_cluster]
        tasks.append((c, m_list))

    logger.info(
        "Running relationship discovery on %d clusters (workers=%d, only_labeled=%s)",
        len(tasks),
        parallel_workers,
        only_labeled,
    )

    results: dict[str, int] = {}
    completed = 0
    failed_clusters: list[str] = []

    def _run_task(item: tuple[Cluster, list[Market]]) -> tuple[str, list[MarketRelation] | None]:
        c, m_list = item
        return _process_one_cluster(
            c,
            m_list,
            openai_api_key=settings.openai_api_key,
            openai_model=settings.openai_model,
            openai_api_base=settings.openai_api_base,
            max_relations_per_cluster=max_relations_per_cluster,
        )

    with ThreadPoolExecutor(max_workers=parallel_workers) as executor:
        futures = {executor.submit(_run_task, item): item[0].cluster_id for item in tasks}
        for future in as_completed(futures):
            cluster_id = futures[future]
            try:
                cid, relations = future.result()
                if relations is None:
                    failed_clusters.append(cid)
                    continue
                try:
                    write_relations_for_cluster(
                        database_url, cluster_id=cid, relations=relations
                    )
                    results[cid] = len(relations)
                except Exception as exc:
                    logger.warning("Cluster %s: write failed (%s); skipping", cid, exc)
                    failed_clusters.append(cid)
            except Exception as exc:
                logger.warning("Cluster %s: unexpected error (%s); skipping", cluster_id, exc)
                failed_clusters.append(cluster_id)
            completed += 1
            if completed == 1 or completed % max(1, len(tasks) // 10) == 0 or completed == len(tasks):
                logger.info(
                    "Relations: completed %d/%d clusters (%d written, %d failed)",
                    completed,
                    len(tasks),
                    len(results),
                    len(failed_clusters),
                )

    if failed_clusters:
        logger.warning("Relations: %d cluster(s) failed or skipped: %s", len(failed_clusters), failed_clusters[:10])

    return results

