"""Configuration via environment and pydantic-settings."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings. Load from .env and environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="VERIBOND_",
        case_sensitive=False,
    )

    # Paths (relative to project root or absolute)
    data_dir: Path = Field(default=Path("data"), description="Base data directory")
    raw_data_dir: Path = Field(default=Path("data/raw"), description="Raw data (e.g. Kaggle CSV)")
    processed_data_dir: Path = Field(
        default=Path("data/processed"),
        description="Processed outputs (DB, artifacts)",
    )

    # Database
    database_url: str = Field(
        default="sqlite:///data/processed/veribond_semantic.db",
        description="SQLite or PostgreSQL URL",
    )

    # Embeddings
    embedding_provider: str = Field(
        default="local",
        description="Provider: 'local' (sentence-transformers) or 'openai' (OpenAI Embeddings API)",
    )
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        description="Sentence-transformers model (local) or OpenAI model e.g. text-embedding-3-small (openai)",
    )
    embedding_dim: int = Field(
        default=384,
        ge=1,
        le=4096,
        description="Embedding dimension. Local: 384 (MiniLM). OpenAI: 1536 (3-small) or 3072 (3-large). Must match provider.",
    )
    embed_batch_size: int = Field(default=64, ge=1, le=512, description="Batch size for embedding")
    embedding_cache_enabled: bool = Field(
        default=True,
        description="When True and provider=openai, cache embeddings by (market_id, text_hash) to avoid re-calling API",
    )
    embedding_openai_batch_size: int = Field(
        default=100,
        ge=1,
        le=2048,
        description="Max texts per OpenAI Embeddings API request (openai allows up to 2048)",
    )
    embedding_openai_delay_between_batches_seconds: float = Field(
        default=0.5,
        ge=0.0,
        le=60.0,
        description="Delay between OpenAI embed batches (seconds). Use >0 to avoid 429 TPM rate limit on large runs.",
    )
    embedding_openai_max_retries_429: int = Field(
        default=8,
        ge=1,
        le=30,
        description="Max retries per batch when OpenAI returns 429 rate limit.",
    )

    # Chroma (vector store)
    chroma_collection_name: str = Field(
        default="markets",
        description="Chroma collection name for market embeddings",
    )

    # Clustering
    cluster_ratio: float = Field(
        default=0.1,
        ge=0.01,
        le=1.0,
        description="K = floor(N * cluster_ratio); paper uses N/10",
    )
    max_clusters: int = Field(
        default=1000,
        ge=1,
        le=50000,
        description="Cap on K so clustering stays fast for large N",
    )

    # LLM (optional; for labeling and relationship discovery)
    openai_api_key: str | None = Field(default=None, description="OpenAI or OpenRouter API key")
    openai_api_base: str | None = Field(
        default=None,
        description="API base URL (e.g. https://openrouter.ai/api/v1). Leave unset for OpenAI.",
    )
    openai_model: str = Field(default="gpt-4o-mini", description="OpenAI model for labeling/relations")
    label_sample_size: int = Field(
        default=20,
        ge=1,
        le=200,
        description="How many market questions to sample per cluster for labeling",
    )
    label_max_clusters: int = Field(
        default=200,
        ge=1,
        le=10000,
        description="Max clusters to label per run (safety + cost control)",
    )
    label_parallel_workers: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of clusters to label in parallel (LLM calls)",
    )
    relations_max_clusters: int = Field(
        default=100,
        ge=1,
        le=10000,
        description="Max clusters for relationship discovery per run",
    )
    relations_max_markets_per_cluster: int = Field(
        default=40,
        ge=2,
        le=200,
        description="Max markets per cluster to send to the LLM for relations",
    )
    relations_max_relations_per_cluster: int = Field(
        default=60,
        ge=1,
        le=200,
        description="Soft cap on number of relations per cluster (enforced in prompt)",
    )
    relations_parallel_workers: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of clusters to process in parallel for relation discovery",
    )
    relations_excluded_clusters_csv: str = Field(
        default="",
        description="Comma-separated cluster ids to exclude from relation discovery (e.g. c_21,c_31); set from eval export of worst clusters",
    )
    # Phase 1 filters: cosine (Option B), time overlap, outcome consistency
    relations_min_cosine_sim: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Min cosine similarity to at least one other market in cluster (Option B outlier removal); 0 = disabled",
    )
    relations_require_time_overlap: bool = Field(
        default=True,
        description="When True, drop markets with no temporal neighbor (overlap or start within max_start_gap_days); only when both have dates",
    )
    relations_max_start_gap_days: float = Field(
        default=90.0,
        ge=0.0,
        le=365 * 2,
        description="Max gap in days between start times to consider markets temporal neighbors; only applied when both have start_time",
    )
    relations_outcome_filter: bool = Field(
        default=False,
        description="When True, do not store a relation if both markets are resolved and outcome contradicts prediction (SAME vs OPPOSITE)",
    )

    # Evaluation (compare predicted relations to resolved outcomes)
    eval_min_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Only evaluate relations with confidence >= this (0 = all)",
    )
    eval_confidence_buckets: list[float] = Field(
        default=[0.5, 0.7, 0.9],
        description="Confidence bucket boundaries for breakdown (e.g. [0.5, 0.7, 0.9])",
    )

    # Polymarket / APIs
    polymarket_api_base: str = Field(
        default="https://gamma-api.polymarket.com",
        description="Polymarket Gamma API base URL",
    )
    polymarket_api_key: str | None = Field(default=None, description="Polymarket API key if required")

    # Filters (paper-aligned)
    min_duration_days: float = Field(
        default=7.0,
        ge=0,
        description="Minimum market duration in days for evaluation subset",
    )

    @property
    def raw_data_path(self) -> Path:
        """Path to raw data directory (e.g. Kaggle CSV)."""
        if self.raw_data_dir.is_absolute():
            return self.raw_data_dir
        return self.data_dir / self.raw_data_dir.name

    @property
    def processed_data_path(self) -> Path:
        """Path to processed data directory (DB, artifacts)."""
        if self.processed_data_dir.is_absolute():
            return self.processed_data_dir
        return self.data_dir / self.processed_data_dir.name

    @property
    def chroma_persist_path(self) -> Path:
        """Path for ChromaDB persistent storage."""
        return self.processed_data_path / "chroma"


def get_settings() -> Settings:
    """Return application settings (singleton-style; can be overridden in tests)."""
    return Settings()
