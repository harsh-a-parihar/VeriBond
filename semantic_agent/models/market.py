"""Pydantic models for markets, clusters, and relations."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ResolvedOutcome = Literal["YES", "NO"]


class Market(BaseModel):
    """Single prediction market (tradeable contract) within one platform."""

    id: str = Field(..., description="question_id or condition_id")
    question: str = Field(..., min_length=1)
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_days: float | None = None
    tags: list[str] = Field(default_factory=list)
    resolved_outcome: ResolvedOutcome | None = None
    is_binary: bool = True
    slug: str | None = None
    source: str = Field(default="kaggle", description="kaggle | polymarket | dune | allium")

    model_config = {"frozen": False}


class Cluster(BaseModel):
    """Topical cluster of markets."""

    cluster_id: str = Field(..., description="Unique cluster id")
    market_ids: list[str] = Field(default_factory=list)
    category: str = Field(
        default="other",
        description="politics | macro | finance | crypto | tech | sports | culture | other",
    )
    label_rationale: str | None = None


class MarketRelation(BaseModel):
    """Predicted relationship between two markets (same or opposite outcome)."""

    question_i: str = Field(..., description="Verbatim question text for market i")
    question_j: str = Field(..., description="Verbatim question text for market j")
    market_id_i: str = Field(..., description="Market id for i")
    market_id_j: str = Field(..., description="Market id for j")
    is_same_outcome: bool = Field(
        ...,
        description="True if both resolve same (YES/YES or NO/NO), False if opposite",
    )
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    rationale: str = Field(default="", description="Brief justification")


class MarketRelationList(BaseModel):
    """List of market relations (e.g. per cluster from LLM)."""

    relations: list[MarketRelation] = Field(default_factory=list)


class RelatedMarketsResponse(BaseModel):
    """User-facing response: related markets and suggested pairs."""

    query: str = Field(..., description="User question or market id")
    clusters_touched: list[Cluster] = Field(default_factory=list)
    relations: list[MarketRelation] = Field(default_factory=list)
    suggested_pairs: list[MarketRelation] = Field(
        default_factory=list,
        description="Filtered by confidence threshold",
    )
