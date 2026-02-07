"""Run full fetch from Gamma and optional CSV; write to DB."""

from semantic_agent.config import get_settings
from semantic_agent.pipeline.ingest import load_from_all_sources

if __name__ == "__main__":
    settings = get_settings()
    csv_path = settings.raw_data_path / "polymarket_markets.csv"
    markets = load_from_all_sources(
        settings.database_url,
        csv_path=csv_path,
        use_gamma=True,
        min_duration_days=0.0,
        require_resolved=False,
        require_binary=True,
        csv_nrows=None,
        gamma_max_pages=300,
    )
    print(f"Done: {len(markets)} markets written to {settings.database_url}")
