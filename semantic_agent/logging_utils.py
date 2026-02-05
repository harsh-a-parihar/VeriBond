"""Central logging setup for semantic_agent.

This module provides an idempotent, production-friendly logging configuration.
Call `configure_logging()` once at process startup (or from pipeline entrypoints).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any


class _JsonFormatter(logging.Formatter):
    """Minimal JSON formatter (no extra deps)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "y", "on"}


def configure_logging(*, level: str | None = None, json_logs: bool | None = None) -> None:
    """Configure root logging once (idempotent).

    Env:
      - VERIBOND_LOG_LEVEL: DEBUG|INFO|WARNING|ERROR (default INFO)
      - VERIBOND_LOG_JSON: true/false (default false)
    """
    root = logging.getLogger()
    if root.handlers:
        return  # already configured

    level = (level or os.getenv("VERIBOND_LOG_LEVEL", "INFO")).upper()
    json_logs = _env_bool("VERIBOND_LOG_JSON", False) if json_logs is None else json_logs

    handler = logging.StreamHandler()
    if json_logs:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )

    root.addHandler(handler)
    root.setLevel(level)

