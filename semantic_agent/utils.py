"""Shared utilities (retry, etc.)."""

import logging
import time
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


def retry_llm(
    fn: Callable[[], T],
    *,
    max_retries: int = 3,
    base_delay: float = 1.0,
) -> T:
    """
    Call fn(); on retryable LLM/API errors, sleep with exponential backoff and retry.
    Retries on 429 (rate limit), 500, 503, and connection errors.
    """
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            status = getattr(e, "status_code", None) if hasattr(e, "status_code") else None
            code = getattr(e, "code", None) if hasattr(e, "code") else None
            retryable = (
                status in (429, 500, 502, 503)
                or code in ("rate_limit_exceeded", "server_error", "api_error")
                or "connection" in str(type(e).__name__).lower()
                or "timeout" in str(e).lower()
            )
            if attempt < max_retries and retryable:
                delay = base_delay * (2**attempt)
                logger.warning("LLM call failed (attempt %d/%d): %s; retrying in %.1fs", attempt + 1, max_retries + 1, e, delay)
                time.sleep(delay)
            else:
                raise
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("retry_llm: unexpected state")
