"""Store: SQLite persistence for markets (and later clusters, relations)."""

import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from semantic_agent.models.market import Market

logger = logging.getLogger(__name__)


def _sqlite_path(database_url: str) -> Path:
    """Extract file path from sqlite:/// URL for sqlite3."""
    if not database_url.startswith("sqlite:///"):
        raise ValueError("Only sqlite:/// URLs are supported")
    path = database_url.replace("sqlite:///", "", 1)
    return Path(path)


def init_schema(database_url: str) -> None:
    """
    Create markets table if it does not exist.
    Ensures parent directory exists for SQLite file.
    """
    path = _sqlite_path(database_url)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS markets (
                id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                description TEXT,
                start_time TEXT,
                end_time TEXT,
                duration_days REAL,
                tags TEXT,
                resolved_outcome TEXT,
                is_binary INTEGER NOT NULL,
                slug TEXT,
                source TEXT NOT NULL
            )
            """
        )
        conn.commit()
        logger.info("Schema initialized at %s", path)
    finally:
        conn.close()


def write_markets(markets: list[Market], database_url: str) -> None:
    """
    Insert or replace markets into the markets table.
    Creates schema if needed.
    """
    if not markets:
        logger.warning("write_markets called with empty list")
        return
    path = _sqlite_path(database_url)
    path.parent.mkdir(parents=True, exist_ok=True)
    init_schema(database_url)
    conn = sqlite3.connect(str(path))
    try:
        for m in markets:
            start_time = m.start_time.isoformat() if m.start_time else None
            end_time = m.end_time.isoformat() if m.end_time else None
            tags_json = json.dumps(m.tags)
            conn.execute(
                """
                INSERT OR REPLACE INTO markets
                (id, question, description, start_time, end_time, duration_days, tags,
                 resolved_outcome, is_binary, slug, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    m.id,
                    m.question,
                    m.description or "",
                    start_time,
                    end_time,
                    m.duration_days,
                    tags_json,
                    m.resolved_outcome,
                    1 if m.is_binary else 0,
                    m.slug or "",
                    m.source,
                ),
            )
        conn.commit()
        logger.info("Wrote %d markets to %s", len(markets), path)
    finally:
        conn.close()


def read_markets(database_url: str) -> list[Market]:
    """
    Read all markets from the markets table.
    Returns list of Market models.
    """
    path = _sqlite_path(database_url)
    if not path.exists():
        logger.warning("Database not found at %s", path)
        return []
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM markets").fetchall()
    finally:
        conn.close()
    markets: list[Market] = []
    for row in rows:
        tags_raw = row["tags"]
        if isinstance(tags_raw, str) and tags_raw:
            try:
                tags = json.loads(tags_raw)
            except json.JSONDecodeError:
                tags = []
        else:
            tags = []
        start_time = row["start_time"]
        end_time = row["end_time"]
        if start_time:
            try:
                start_time = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            except Exception:
                start_time = None
        else:
            start_time = None
        if end_time:
            try:
                end_time = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            except Exception:
                end_time = None
        else:
            end_time = None
        description = row["description"] or None
        if description == "":
            description = None
        slug = row["slug"] or None
        if slug == "":
            slug = None
        resolved = row["resolved_outcome"]
        if resolved not in ("YES", "NO"):
            resolved = None
        markets.append(
            Market(
                id=row["id"],
                question=row["question"],
                description=description,
                start_time=start_time,
                end_time=end_time,
                duration_days=row["duration_days"],
                tags=tags,
                resolved_outcome=resolved,
                is_binary=bool(row["is_binary"]),
                slug=slug,
                source=row["source"] or "csv",
            )
        )
    logger.info("Read %d markets from %s", len(markets), path)
    return markets
