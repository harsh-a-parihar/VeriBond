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
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        description="Sentence-transformers model or OpenAI model name",
    )
    embedding_dim: int = Field(default=384, ge=1, le=4096, description="Embedding dimension")

    # Clustering
    cluster_ratio: float = Field(
        default=0.1,
        ge=0.01,
        le=1.0,
        description="K = floor(N * cluster_ratio); paper uses N/10",
    )

    # LLM (optional; for labeling and relationship discovery)
    openai_api_key: str | None = Field(default=None, description="OpenAI API key")
    openai_model: str = Field(default="gpt-4o-mini", description="OpenAI model for labeling/relations")

    # Polymarket / APIs
    polymarket_api_base: str = Field(
        default="https://gamma-api.polymarket.com",
        description="Polymarket API base URL",
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


def get_settings() -> Settings:
    """Return application settings (singleton-style; can be overridden in tests)."""
    return Settings()
