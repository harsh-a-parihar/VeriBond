"""Polymarket Gamma API fetcher: closed/resolved events and markets."""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import requests

from semantic_agent.models.market import Market, ResolvedOutcome

logger = logging.getLogger(__name__)

# Pagination
DEFAULT_PAGE_SIZE = 100

# Timeouts and retries (Gamma API can be slow or transiently unreachable)
GAMMA_CONNECT_TIMEOUT = 60  # seconds for TCP connect
GAMMA_READ_TIMEOUT = 90     # seconds for first byte / full response
GAMMA_MAX_RETRIES = 3       # retries per request with backoff
GAMMA_RETRY_BACKOFF_BASE = 5  # seconds; doubled each retry


def _parse_outcome_prices(outcomes_raw: Any, outcome_prices_raw: Any) -> tuple[ResolvedOutcome | None, bool]:
    """Parse outcomes and outcomePrices JSON strings; return (resolved_outcome, is_binary)."""
    if outcomes_raw is None and outcome_prices_raw is None:
        return None, True
    for raw in (outcomes_raw, outcome_prices_raw):
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                return None, False
    outcomes = outcomes_raw if isinstance(outcomes_raw, list) else (json.loads(outcomes_raw) if isinstance(outcomes_raw, str) else [])
    prices = outcome_prices_raw if isinstance(outcome_prices_raw, list) else (json.loads(outcome_prices_raw) if isinstance(outcome_prices_raw, str) else [])
    if not outcomes or not prices or len(outcomes) != len(prices):
        return None, False
    if len(outcomes) != 2:
        return None, False
    try:
        values = [float(p) for p in prices]
    except (TypeError, ValueError):
        return None, True
    winner_index = values.index(max(values))
    resolved: ResolvedOutcome = "YES" if winner_index == 0 else "NO"
    return resolved, True


def _safe_datetime(value: Any) -> datetime | None:
    """Parse ISO datetime; return timezone-naive or None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _market_from_event_market(event: dict[str, Any], market: dict[str, Any]) -> Market | None:
    """Build one Market from a Gamma event and its nested market."""
    question = market.get("question") or market.get("title") or ""
    question = (question or "").strip()
    if not question:
        return None
    market_id = str(market.get("id") or market.get("conditionId") or market.get("condition_id") or "")
    if not market_id:
        return None
    resolved_outcome, is_binary = _parse_outcome_prices(market.get("outcomes"), market.get("outcomePrices"))
    if not is_binary:
        return None
    start = _safe_datetime(event.get("startDate") or event.get("start_time") or event.get("startTime"))
    end = _safe_datetime(event.get("endDate") or event.get("end_date_iso") or event.get("end_time") or event.get("endTime"))
    duration_days: float | None = None
    if start and end and end > start:
        duration_days = (end - start).total_seconds() / (24 * 3600)
    tags_raw = event.get("tags") or []
    tags = []
    for t in tags_raw if isinstance(tags_raw, list) else []:
        if isinstance(t, dict) and t.get("label"):
            tags.append(str(t["label"]))
        elif isinstance(t, str):
            tags.append(t)
    slug = event.get("slug") or market.get("slug") or None
    slug = str(slug).strip() if slug else None
    return Market(
        id=market_id,
        question=question,
        description=market.get("description") or None,
        start_time=start,
        end_time=end,
        duration_days=duration_days,
        tags=tags,
        resolved_outcome=resolved_outcome,
        is_binary=True,
        slug=slug,
        source="gamma",
    )


def fetch_markets_from_gamma(
    base_url: str = "https://gamma-api.polymarket.com",
    *,
    closed: bool = True,
    limit: int = DEFAULT_PAGE_SIZE,
    max_pages: int | None = 50,
) -> list[Market]:
    """
    Fetch closed (resolved) markets from Polymarket Gamma API.

    Uses GET /events per official docs:
    https://docs.polymarket.com/developers/gamma-markets-api/get-events
    https://docs.polymarket.com/developers/gamma-markets-api/fetch-markets-guide

    Query params (per Fetching Markets guide): closed, limit, offset, order, ascending.
    Paginates with limit/offset; flattens event.markets into Market list.
    """
    url = base_url.rstrip("/") + "/events"
    params: dict[str, Any] = {
        "closed": str(closed).lower(),
        "limit": limit,
        "offset": 0,
        "order": "id",
        "ascending": "false",
    }
    all_markets: list[Market] = []
    seen_ids: set[str] = set()
    page = 0
    timeout = (GAMMA_CONNECT_TIMEOUT, GAMMA_READ_TIMEOUT)
    while True:
        if max_pages is not None and page >= max_pages:
            logger.info("Gamma: reached max_pages=%d", max_pages)
            break
        data: Any = None
        last_error: Exception | None = None
        for attempt in range(GAMMA_MAX_RETRIES):
            try:
                resp = requests.get(url, params=params, timeout=timeout)
                resp.raise_for_status()
                data = resp.json()
                last_error = None
                break
            except requests.RequestException as e:
                last_error = e
                if attempt < GAMMA_MAX_RETRIES - 1:
                    delay = GAMMA_RETRY_BACKOFF_BASE * (2 ** attempt)
                    logger.warning(
                        "Gamma: request failed (offset=%d, attempt %d/%d): %s; retrying in %.0fs",
                        params["offset"], attempt + 1, GAMMA_MAX_RETRIES, e, delay,
                    )
                    time.sleep(delay)
                else:
                    logger.warning("Gamma: request failed (offset=%d) after %d attempts: %s", params["offset"], GAMMA_MAX_RETRIES, e)
                    break
            except (ValueError, TypeError) as e:
                logger.warning("Gamma: invalid JSON (offset=%d): %s", params["offset"], e)
                last_error = e
                break
        if last_error is not None or data is None:
            break
        if not isinstance(data, list) or len(data) == 0:
            break
        for event in data:
            markets_nested = event.get("markets") or []
            for m in markets_nested:
                market = _market_from_event_market(event, m)
                if market and market.id not in seen_ids:
                    seen_ids.add(market.id)
                    all_markets.append(market)
        if len(data) < limit:
            break
        params["offset"] += limit
        page += 1
        logger.info("Gamma: fetched page %d, total markets so far %d", page, len(all_markets))
    logger.info("Gamma: fetched %d unique markets", len(all_markets))
    return all_markets
