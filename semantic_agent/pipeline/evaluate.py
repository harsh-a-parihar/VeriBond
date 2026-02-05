"""Evaluation: compare predicted relations to resolved outcomes (ground truth)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from semantic_agent.config import get_settings
from semantic_agent.logging_utils import configure_logging
from semantic_agent.models.market import MarketRelation, ResolvedOutcome
from semantic_agent.store import read_markets, read_relations

logger = logging.getLogger(__name__)


@dataclass
class EvalBucket:
    """Aggregate counts and accuracy for a bucket (e.g. cluster or confidence range)."""

    n: int = 0
    correct: int = 0

    @property
    def accuracy(self) -> float:
        return self.correct / self.n if self.n else 0.0


@dataclass
class EvalResult:
    """Result of run_evaluate_relations: overall and breakdown by cluster / confidence."""

    total_relations: int = 0
    total_evaluable: int = 0
    total_correct: int = 0
    by_cluster: dict[str, EvalBucket] = field(default_factory=dict)
    by_confidence_bucket: dict[str, EvalBucket] = field(default_factory=dict)

    @property
    def accuracy(self) -> float:
        return self.total_correct / self.total_evaluable if self.total_evaluable else 0.0


def _confidence_bucket_label(score: float, boundaries: list[float]) -> str:
    """Assign a label like '0.5-0.7' or '>=0.9' for breakdown."""
    if not boundaries:
        return "all"
    sorted_b = sorted(boundaries)
    for i, b in enumerate(sorted_b):
        if score < b:
            low = sorted_b[i - 1] if i else 0.0
            return f"{low}-{b}"
    return f">={sorted_b[-1]}"


def run_evaluate_relations(
    database_url: str | None = None,
) -> EvalResult:
    """
    Compare predicted relations to resolved outcomes.
    Only relations where both markets have resolved_outcome (YES/NO) are evaluable.
    Returns EvalResult with overall accuracy and breakdown by cluster and confidence bucket.
    """
    configure_logging()
    settings = get_settings()
    db_url = database_url or settings.database_url
    min_conf = settings.eval_min_confidence
    buckets = settings.eval_confidence_buckets or [0.5, 0.7, 0.9]

    relations_with_cluster = read_relations(db_url)
    markets = read_markets(db_url)
    outcome_by_id: dict[str, ResolvedOutcome] = {
        m.id: m.resolved_outcome
        for m in markets
        if m.resolved_outcome is not None
    }

    result = EvalResult(total_relations=len(relations_with_cluster))

    for cluster_id, rel in relations_with_cluster:
        if rel.confidence_score < min_conf:
            continue
        o_i = outcome_by_id.get(rel.market_id_i)
        o_j = outcome_by_id.get(rel.market_id_j)
        if o_i is None or o_j is None:
            continue
        result.total_evaluable += 1
        ground_truth_same = o_i == o_j
        correct = rel.is_same_outcome == ground_truth_same
        if correct:
            result.total_correct += 1

        if cluster_id not in result.by_cluster:
            result.by_cluster[cluster_id] = EvalBucket()
        b = result.by_cluster[cluster_id]
        b.n += 1
        if correct:
            b.correct += 1

        label = _confidence_bucket_label(rel.confidence_score, buckets)
        if label not in result.by_confidence_bucket:
            result.by_confidence_bucket[label] = EvalBucket()
        bc = result.by_confidence_bucket[label]
        bc.n += 1
        if correct:
            bc.correct += 1

    logger.info(
        "Evaluation: %d relations, %d evaluable, %d correct, accuracy=%.2f",
        result.total_relations,
        result.total_evaluable,
        result.total_correct,
        result.accuracy,
    )
    return result
