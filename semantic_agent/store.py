"""Store: SQLite persistence for markets (and later clusters, relations)."""

import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from semantic_agent.models.market import Cluster, Market
from semantic_agent.logging_utils import configure_logging

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
    configure_logging()
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clusters (
                cluster_id TEXT PRIMARY KEY,
                category TEXT NOT NULL DEFAULT 'other',
                label_rationale TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS market_clusters (
                market_id TEXT PRIMARY KEY,
                cluster_id TEXT NOT NULL,
                FOREIGN KEY (market_id) REFERENCES markets(id),
                FOREIGN KEY (cluster_id) REFERENCES clusters(cluster_id)
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
    configure_logging()
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
    configure_logging()
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


def write_clusters(clusters: list[Cluster], database_url: str) -> None:
    """
    Write clusters and market-cluster assignments to the database.
    Replaces existing cluster data.
    """
    configure_logging()
    if not clusters:
        logger.warning("write_clusters called with empty list")
        return
    path = _sqlite_path(database_url)
    path.parent.mkdir(parents=True, exist_ok=True)
    init_schema(database_url)
    conn = sqlite3.connect(str(path))
    try:
        conn.execute("DELETE FROM market_clusters")
        conn.execute("DELETE FROM clusters")
        for c in clusters:
            conn.execute(
                """
                INSERT OR REPLACE INTO clusters (cluster_id, category, label_rationale)
                VALUES (?, ?, ?)
                """,
                (c.cluster_id, c.category, c.label_rationale or ""),
            )
            for market_id in c.market_ids:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO market_clusters (market_id, cluster_id)
                    VALUES (?, ?)
                    """,
                    (market_id, c.cluster_id),
                )
        conn.commit()
        logger.info("Wrote %d clusters to %s", len(clusters), path)
    finally:
        conn.close()


def read_clusters(database_url: str) -> list[Cluster]:
    """Read all clusters and their market assignments from the database."""
    configure_logging()
    path = _sqlite_path(database_url)
    if not path.exists():
        logger.warning("Database not found at %s", path)
        return []
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        cluster_rows = conn.execute(
            "SELECT cluster_id, category, label_rationale FROM clusters"
        ).fetchall()
        assignments = conn.execute(
            "SELECT market_id, cluster_id FROM market_clusters"
        ).fetchall()
    finally:
        conn.close()
    market_ids_by_cluster: dict[str, list[str]] = {r["cluster_id"]: [] for r in cluster_rows}
    for row in assignments:
        cid = row["cluster_id"]
        if cid in market_ids_by_cluster:
            market_ids_by_cluster[cid].append(row["market_id"])
    clusters = []
    for row in cluster_rows:
        cid = row["cluster_id"]
        category = row["category"] or "other"
        rationale = row["label_rationale"] or None
        if rationale == "":
            rationale = None
        clusters.append(
            Cluster(
                cluster_id=cid,
                market_ids=market_ids_by_cluster.get(cid, []),
                category=category,
                label_rationale=rationale,
            )
        )
    logger.info("Read %d clusters from %s", len(clusters), path)
    return clusters
