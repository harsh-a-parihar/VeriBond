"""Ingest: load and normalize market data from CSV (or other sources) into Market list."""

import json
import logging
import re
from datetime import timezone
from pathlib import Path
from typing import Any

import pandas as pd

from semantic_agent.models.market import Market, ResolvedOutcome
from semantic_agent.logging_utils import configure_logging

logger = logging.getLogger(__name__)


def _camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case (e.g. questionID -> question_id)."""
    s = re.sub(r"(?<!^)(?=[A-Z])", "_", str(name)).lower().replace(" ", "_")
    return s.strip("_")


def _parse_tokens(tokens: Any) -> tuple[ResolvedOutcome | None, bool]:
    """
    Parse tokens column to get resolved_outcome and is_binary.
    Expects list of dicts with 'outcome' (YES/NO) and 'winner' (bool).
    When tokens is missing, returns (None, True) so rows are not dropped when require_binary=True.
    """
    if tokens is None or (isinstance(tokens, float) and pd.isna(tokens)):
        return None, True  # assume binary when column missing so we don't drop all rows
    if isinstance(tokens, str):
        try:
            tokens = json.loads(tokens)
        except json.JSONDecodeError:
            return None, False
    if not isinstance(tokens, list) or len(tokens) == 0:
        return None, False
    is_binary = len(tokens) == 2
    resolved: ResolvedOutcome | None = None
    for t in tokens:
        if isinstance(t, dict) and t.get("winner") is True:
            out = t.get("outcome")
            if out in ("YES", "NO"):
                resolved = out
                break
    return resolved, is_binary


def _resolved_outcome_from_uma_and_prices(
    uma_resolution_status: Any,
    outcome_prices_raw: Any,
    outcomes_raw: Any,
) -> tuple[ResolvedOutcome | None, bool]:
    """
    Derive resolved_outcome from Kaggle-style columns: umaResolutionStatus, outcomePrices, outcomes.

    When umaResolutionStatus == "resolved", the outcome with price 1 (or max price) is the winner.
    For binary markets we map winner index 0 -> YES, 1 -> NO so evaluation (same/opposite outcome)
    is consistent across markets.

    Returns (resolved_outcome, is_binary). (None, True) when not resolved or unparseable.
    """
    if uma_resolution_status != "resolved":
        return None, True
    if outcome_prices_raw is None or (isinstance(outcome_prices_raw, float) and pd.isna(outcome_prices_raw)):
        return None, True
    if outcomes_raw is None or (isinstance(outcomes_raw, float) and pd.isna(outcomes_raw)):
        return None, True
    prices_str = outcome_prices_raw if isinstance(outcome_prices_raw, str) else str(outcome_prices_raw)
    outcomes_str = outcomes_raw if isinstance(outcomes_raw, str) else str(outcomes_raw)
    if not prices_str.strip() or not outcomes_str.strip():
        return None, True
    try:
        prices = json.loads(prices_str)
        outcomes = json.loads(outcomes_str)
    except (json.JSONDecodeError, TypeError):
        return None, True
    if not isinstance(prices, list) or not isinstance(outcomes, list) or len(prices) != len(outcomes):
        return None, True
    if len(prices) != 2:
        return None, False  # not binary
    try:
        values = [float(p) for p in prices]
    except (TypeError, ValueError):
        return None, True
    winner_index = values.index(max(values))
    # Map position to YES/NO for evaluation consistency (first outcome = YES, second = NO)
    resolved: ResolvedOutcome = "YES" if winner_index == 0 else "NO"
    return resolved, True


def _safe_datetime(value: Any) -> Any:
    """Parse datetime from string or return None. Always returns timezone-naive for subtraction."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        dt = pd.to_datetime(value)
        if hasattr(dt, "to_pydatetime"):
            dt = dt.to_pydatetime()
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names: camelCase to snake_case, then map common names."""
    df = df.copy()
    df.columns = [_camel_to_snake(str(c).strip()) for c in df.columns]
    renames = {
        "end_date_iso": "end_time",
        "game_start_time": "start_time",
    }
    for old, new in renames.items():
        if old in df.columns and new not in df.columns:
            df = df.rename(columns={old: new})
    return df


def load_markets_from_csv(
    path: str | Path,
    *,
    source_label: str = "csv",
    min_duration_days: float = 7.0,
    require_resolved: bool = False,
    require_binary: bool = True,
    nrows: int | None = None,
) -> list[Market]:
    """
    Load a CSV of prediction markets and normalize into Market list.

    Resolved outcome is derived from either:
    - tokens: JSON list of dicts with 'outcome' (YES/NO) and 'winner' (bool), or
    - Kaggle-style: uma_resolution_status == "resolved" plus outcome_prices (JSON
      array of final prices) and outcomes (JSON array of labels); winner = index of
      max price; mapped to YES (index 0) / NO (index 1) for evaluation.

    Expects columns: question, (question_id or condition_id), optional description,
    start_time/end_time or game_start_time/end_date_iso, optional tags.

    Args:
        path: Path to CSV file.
        source_label: Label for Market.source (e.g. "csv", "export").
        min_duration_days: Minimum duration in days; markets below are skipped.
        require_resolved: If True, only return markets with resolved_outcome set.
        require_binary: If True, only return markets with exactly 2 outcomes.

    Returns:
        List of Market models with derived resolved_outcome, duration_days, is_binary.
    """
    configure_logging()
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    df = pd.read_csv(path, low_memory=False, nrows=nrows)
    df = _normalize_columns(df)

    if "question" not in df.columns:
        raise ValueError("CSV must have a 'question' column")

    id_col = "question_id" if "question_id" in df.columns else "condition_id"
    if id_col not in df.columns and "condition_id" not in df.columns:
        df["question_id"] = df.index.astype(str)
        id_col = "question_id"

    markets: list[Market] = []
    for _, row in df.iterrows():
        question = str(row.get("question", "")).strip()
        if not question:
            continue

        tokens_raw = row.get("tokens")
        resolved_outcome, is_binary = _parse_tokens(tokens_raw)
        # Kaggle Polymarket CSV: no "tokens"; use uma_resolution_status + outcome_prices + outcomes
        if resolved_outcome is None:
            uma_resolved, is_binary_uma = _resolved_outcome_from_uma_and_prices(
                row.get("uma_resolution_status"),
                row.get("outcome_prices"),
                row.get("outcomes"),
            )
            if uma_resolved is not None:
                resolved_outcome = uma_resolved
                is_binary = is_binary_uma
        if require_binary and not is_binary:
            continue
        if require_resolved and resolved_outcome is None:
            continue

        start_time = _safe_datetime(row.get("start_time") or row.get("game_start_time"))
        end_time = _safe_datetime(row.get("end_time") or row.get("end_date_iso"))
        duration_days: float | None = None
        if start_time and end_time:
            delta = end_time - start_time
            duration_days = delta.total_seconds() / (24 * 3600)
            if min_duration_days > 0 and duration_days is not None and duration_days < min_duration_days:
                continue

        tags_raw = row.get("tags")
        if isinstance(tags_raw, str):
            try:
                tags = json.loads(tags_raw) if tags_raw else []
            except json.JSONDecodeError:
                tags = []
        elif isinstance(tags_raw, list):
            tags = [str(t) for t in tags_raw]
        else:
            tags = []

        description = row.get("description")
        if description is not None and (isinstance(description, float) and pd.isna(description)):
            description = None
        elif description is not None:
            description = str(description).strip() or None

        market_id = str(row.get(id_col, row.get("condition_id", ""))).strip() or str(row.name)
        slug = row.get("market_slug") or row.get("slug")
        slug = str(slug).strip() if slug is not None and not (isinstance(slug, float) and pd.isna(slug)) else None

        markets.append(
            Market(
                id=market_id,
                question=question,
                description=description,
                start_time=start_time,
                end_time=end_time,
                duration_days=duration_days,
                tags=tags,
                resolved_outcome=resolved_outcome,
                is_binary=is_binary,
                slug=slug,
                source=source_label,
            )
        )

    logger.info("Loaded %d markets from %s", len(markets), path)
    return markets


def load_from_csv_and_save(
    path: str | Path,
    database_url: str,
    *,
    source_label: str = "csv",
    min_duration_days: float = 7.0,
    require_resolved: bool = False,
    require_binary: bool = True,
    nrows: int | None = None,
) -> list[Market]:
    """
    Load markets from CSV and write them to the SQLite store.
    Returns the same list of Market models (for chaining or inspection).
    """
    configure_logging()
    from semantic_agent.store import init_schema, write_markets

    markets = load_markets_from_csv(
        path,
        source_label=source_label,
        min_duration_days=min_duration_days,
        require_resolved=require_resolved,
        require_binary=require_binary,
        nrows=nrows,
    )
    init_schema(database_url)
    write_markets(markets, database_url)
    return markets
