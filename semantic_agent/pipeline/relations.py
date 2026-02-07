"""Relationship discovery: LLM-predicted relations between markets within clusters."""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from semantic_agent.logging_utils import configure_logging
from semantic_agent.models.market import Cluster, Market, MarketRelation, MarketRelationList
from semantic_agent.utils import retry_llm

logger = logging.getLogger(__name__)


def _safe_json_loads(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except Exception:
        return None


def _repair_json(text: str) -> str | None:
    """Strip markdown, extract first {...}, or try to extract relations array for parsing."""
    s = (text or "").strip()
    # Remove markdown code fence
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    s = s.strip()
    # Try full object first
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = s[start : end + 1]
        # Try to fix common bracket imbalances (e.g. missing closing })
        open_braces = candidate.count("{") - candidate.count("}")
        if open_braces > 0:
            candidate = candidate + "}" * open_braces
        elif open_braces < 0:
            candidate = candidate[:open_braces]  # trim trailing }
        return candidate
    # Try to extract "relations": [...] and wrap
    idx = s.find('"relations"')
    if idx == -1:
        idx = s.find("'relations'")
    if idx != -1:
        bracket = s.find("[", idx)
        if bracket != -1:
            depth = 1
            i = bracket + 1
            while i < len(s) and depth > 0:
                if s[i] == "[":
                    depth += 1
                elif s[i] == "]":
                    depth -= 1
                i += 1
            if depth == 0:
                arr = s[bracket:i]
                return '{"relations": ' + arr + "}"
    return None


def _filter_market_ids_by_cosine(
    market_ids: list[str],
    chroma_path: Path,
    collection_name: str,
    min_cosine_sim: float,
) -> list[str] | None:
    """
    Option B: keep only market ids that have at least one other market in the list
    with cosine similarity >= min_cosine_sim. Returns None if Chroma unavailable or
    any id missing (caller keeps all).
    """
    if min_cosine_sim <= 0 or not market_ids:
        return None
    chroma_path = Path(chroma_path).resolve()
    if not chroma_path.exists():
        return None
    try:
        import os
        os.environ["ANONYMIZED_TELEMETRY"] = "FALSE"
        import chromadb
        from chromadb.config import Settings as ChromaSettings
        import numpy as np
    except ImportError:
        return None
    try:
        client = chromadb.PersistentClient(
            path=str(chroma_path),
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        collection = client.get_collection(name=collection_name)
    except Exception as e:
        logger.debug("Chroma unavailable for cosine filter: %s", e)
        return None
    result = collection.get(ids=market_ids, include=["embeddings"])
    ids_returned = result["ids"]
    embeddings = result["embeddings"]
    if not ids_returned or len(embeddings) != len(market_ids):
        return None
    X = np.asarray(embeddings, dtype=np.float64)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms
    sim = X @ X.T
    np.fill_diagonal(sim, -1.0)
    max_sim_per_row = np.max(sim, axis=1)
    keep_ids = [market_ids[i] for i in range(len(market_ids)) if max_sim_per_row[i] >= min_cosine_sim]
    if len(keep_ids) < 2:
        return None
    return keep_ids


def _filter_markets_by_time(
    markets: list[Market],
    max_start_gap_days: float,
) -> list[Market]:
    """
    Keep only markets that have at least one temporal neighbor in the list.
    Temporal neighbor: if both have start_time, require overlap or start within max_start_gap_days;
    if either missing dates, allow.
    """
    if max_start_gap_days < 0 or not markets:
        return markets
    out: list[Market] = []
    for mi in markets:
        has_neighbor = False
        for mj in markets:
            if mj.id == mi.id:
                continue
            if mi.start_time is None or mj.start_time is None:
                has_neighbor = True
                break
            ei = mi.end_time or mi.start_time
            ej = mj.end_time or mj.start_time
            if mi.start_time <= ej and mj.start_time <= ei:
                has_neighbor = True
                break
            gap_days = abs((mi.start_time - mj.start_time).total_seconds()) / 86400.0
            if gap_days <= max_start_gap_days:
                has_neighbor = True
                break
        if has_neighbor:
            out.append(mi)
    return out if len(out) >= 2 else markets


def _filter_relations_by_outcome(
    relations: list[MarketRelation],
    markets_by_id: dict[str, Market],
) -> list[MarketRelation]:
    """Drop relations where both markets are resolved and outcome contradicts prediction."""
    out: list[MarketRelation] = []
    for r in relations:
        ma = markets_by_id.get(r.market_id_i)
        mb = markets_by_id.get(r.market_id_j)
        if ma is None or mb is None:
            out.append(r)
            continue
        ai, bi = ma.resolved_outcome, mb.resolved_outcome
        if ai not in ("YES", "NO") or bi not in ("YES", "NO"):
            out.append(r)
            continue
        same_outcome = (ai == bi)
        if same_outcome != r.is_same_outcome:
            continue
        out.append(r)
    return out


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

    # Build compact description of markets in this cluster (numbered for reference)
    lines: list[str] = []
    for i, m in enumerate(markets, 1):
        outcome = m.resolved_outcome or "UNKNOWN"
        lines.append(f"{i}.\nmarket_id: {m.id}\nquestion: \"{m.question}\"\nresolved_outcome: {outcome}")
    markets_block = "\n\n".join(lines)

    system = (
        "You are an expert analyst of prediction markets.\n"
        "Your task is to identify ONLY verifiable, real-world outcome dependencies between markets.\n\n"
        "You must be conservative. If there is no clear causal, logical, or real-world link, output NO_RELATION.\n"
        "Do not guess. Do not assume correlation implies causation.\n"
        "You must follow the JSON schema exactly."
    )

    taxonomy_line = f"Cluster category hint: {taxonomy_hint}.\n\n" if taxonomy_hint else ""

    user = (
        taxonomy_line
        + "You are given a list of prediction markets from the same topical cluster.\n\n"
        "Your task is to identify pairs of markets whose outcomes are clearly dependent in the real world.\n\n"
        "For each pair, determine:\n"
        "1) SAME_OUTCOME: If market A resolves YES, market B is very likely to resolve YES (and same for NO/NO).\n"
        "2) OPPOSITE_OUTCOME: If market A resolves YES, market B is very likely to resolve NO (and vice versa).\n"
        "3) NO_RELATION: No clear, verifiable dependency exists. Output this when uncertain.\n\n"
        "Only output SAME_OUTCOME or OPPOSITE_OUTCOME if you can identify a specific shared real-world event, "
        "rule, or mechanism that links both markets. If you cannot, choose NO_RELATION.\n\n"
        "For every non-NO_RELATION decision you must: (1) Name the shared real-world event; "
        "(2) Explain how it affects both markets; (3) Explain why the relationship is reliable.\n\n"
        "Confidence calibration: 0.90-1.00 = almost deterministic; 0.75-0.89 = strong causal link; "
        "0.60-0.74 = moderate but defensible. If confidence would be < 0.60, output NO_RELATION instead.\n\n"
        "Return ONLY valid JSON in this format:\n"
        "{\n"
        '  "relations": [\n'
        "    {\n"
        '      "market_id_i": "...",\n'
        '      "market_id_j": "...",\n'
        '      "relation_type": "SAME_OUTCOME | OPPOSITE_OUTCOME | NO_RELATION",\n'
        '      "confidence": 0.00,\n'
        '      "shared_event": "...",\n'
        '      "rationale": "..."\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Here are the markets:\n\n"
        + markets_block
    )

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

    def _parse(content: str) -> dict[str, Any] | None:
        data = _safe_json_loads(content)
        if isinstance(data, dict):
            return data
        repaired = _repair_json(content)
        if repaired:
            data = _safe_json_loads(repaired)
            if isinstance(data, dict):
                return data
        return None

    def _stricter_messages():
        return [
            {"role": "system", "content": system + "\n\nOutput ONLY valid JSON. No markdown, no code fences."},
            {"role": "user", "content": user + "\n\nReply with only a single JSON object, no other text."},
        ]

    resp = retry_llm(_create, max_retries=3, base_delay=1.0)
    content = (resp.choices[0].message.content or "").strip()
    data = _parse(content)
    if not isinstance(data, dict):
        # First retry with stricter instruction
        def _retry_create():
            try:
                return client.chat.completions.create(
                    model=openai_model,
                    messages=_stricter_messages(),
                    temperature=0,
                    response_format={"type": "json_object"},
                )
            except TypeError:
                return client.chat.completions.create(
                    model=openai_model,
                    messages=_stricter_messages(),
                    temperature=0,
                )
        retry_resp = _retry_create()
        content = (retry_resp.choices[0].message.content or "").strip()
        data = _parse(content)
    if not isinstance(data, dict):
        # Second retry (Phase 2: reduce lost clusters to bad JSON)
        try:
            retry_resp2 = client.chat.completions.create(
                model=openai_model,
                messages=_stricter_messages(),
                temperature=0,
                response_format={"type": "json_object"},
            )
        except TypeError:
            retry_resp2 = client.chat.completions.create(
                model=openai_model,
                messages=_stricter_messages(),
                temperature=0,
            )
        content = (retry_resp2.choices[0].message.content or "").strip()
        data = _parse(content)
    if not isinstance(data, dict):
        logger.warning("Cluster %s: invalid JSON from LLM (after 2 retries); skipping", cluster.cluster_id)
        return []

    id_to_question = {m.id: (m.question or "").strip() or m.id for m in markets}
    raw_relations = data.get("relations") or []
    out: list[MarketRelation] = []

    for rel in raw_relations:
        if not isinstance(rel, dict):
            continue
        mid_i = (rel.get("market_id_i") or "").strip()
        mid_j = (rel.get("market_id_j") or "").strip()
        if not mid_i or not mid_j or mid_i == mid_j:
            continue
        if mid_i not in id_to_question or mid_j not in id_to_question:
            continue

        # New format: relation_type + confidence + shared_event
        relation_type = (rel.get("relation_type") or "").strip().upper()
        confidence = rel.get("confidence")
        if confidence is not None:
            try:
                confidence = float(confidence)
            except (TypeError, ValueError):
                confidence = 0.0
        else:
            confidence = rel.get("confidence_score", 0.0)
            try:
                confidence = float(confidence)
            except (TypeError, ValueError):
                confidence = 0.0

        if relation_type == "NO_RELATION" or confidence < 0.6:
            continue
        if relation_type not in ("SAME_OUTCOME", "OPPOSITE_OUTCOME"):
            # Fallback: old format with is_same_outcome
            same = rel.get("is_same_outcome")
            if same is None:
                continue
            relation_type = "SAME_OUTCOME" if same else "OPPOSITE_OUTCOME"

        is_same_outcome = relation_type == "SAME_OUTCOME"
        rationale = (rel.get("rationale") or "").strip() or ""
        shared_event = (rel.get("shared_event") or "").strip() or None
        if not shared_event:
            shared_event = None

        question_i = (rel.get("question_i") or "").strip() or id_to_question.get(mid_i, mid_i)
        question_j = (rel.get("question_j") or "").strip() or id_to_question.get(mid_j, mid_j)

        out.append(
            MarketRelation(
                market_id_i=mid_i,
                market_id_j=mid_j,
                question_i=question_i,
                question_j=question_j,
                is_same_outcome=is_same_outcome,
                confidence_score=min(1.0, max(0.0, confidence)),
                rationale=rationale,
                shared_event=shared_event,
            )
        )

    if len(out) > max_relations:
        out = out[:max_relations]
    return out


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

    excluded_csv = getattr(settings, "relations_excluded_clusters_csv", "") or ""
    excluded_ids = [x.strip() for x in excluded_csv.split(",") if x.strip()]
    if excluded_ids:
        before = len(clusters)
        clusters = [c for c in clusters if c.cluster_id not in excluded_ids]
        logger.info("Excluded %d clusters by config (relations_excluded_clusters_csv): %s", before - len(clusters), excluded_ids[:10])

    clusters = clusters[:max_clusters]

    all_markets = read_markets(database_url)
    markets_by_id: dict[str, Market] = {m.id: m for m in all_markets}

    # Phase 1 filters: cosine (Option B), time overlap
    min_cosine_sim = getattr(settings, "relations_min_cosine_sim", 0.0)
    require_time_overlap = getattr(settings, "relations_require_time_overlap", False)
    max_start_gap_days = getattr(settings, "relations_max_start_gap_days", 90.0)
    chroma_path = Path(settings.chroma_persist_path)
    collection_name = settings.chroma_collection_name

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

        # Cosine filter (Option B): drop outlier markets with no neighbor above threshold
        if min_cosine_sim > 0:
            keep_ids = _filter_market_ids_by_cosine(
                [m.id for m in m_list], chroma_path, collection_name, min_cosine_sim
            )
            if keep_ids is not None:
                m_list = [m for m in m_list if m.id in keep_ids]
                if len(m_list) < 2:
                    logger.debug("Cluster %s skipped (cosine filter left < 2 markets)", c.cluster_id)
                    continue

        # Time filter: drop markets with no temporal neighbor (only when both have dates)
        if require_time_overlap:
            m_list = _filter_markets_by_time(m_list, max_start_gap_days)
            if len(m_list) < 2:
                logger.debug("Cluster %s skipped (time filter left < 2 markets)", c.cluster_id)
                continue

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
                # Phase 1: outcome filter — do not store if both resolved and outcome contradicts prediction
                if getattr(settings, "relations_outcome_filter", True):
                    relations = _filter_relations_by_outcome(relations, markets_by_id)
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

