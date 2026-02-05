"""FastAPI app for admin dashboard: pipeline, dataset upload, logs."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Import after env is loaded (app is created at import time)
# Pipeline and config are imported inside route handlers to avoid loading heavy deps at startup.

app = FastAPI(
    title="VeriBond Admin API",
    description="Pipeline control, dataset upload, and logs for the semantic agent.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request/response models ---

class IngestBody(BaseModel):
    csv_path: str | None = Field(None, description="Filename in data/raw or relative path; default polymarket_markets.csv")
    nrows: int | None = Field(None, description="Max CSV rows to load; null = all")


class RunFullBody(BaseModel):
    csv_path: str | None = Field(None, description="Filename in data/raw; default polymarket_markets.csv")
    nrows: int | None = Field(None, description="Max CSV rows; null = all")


class RelationsBody(BaseModel):
    skip_clusters_with_relations: bool = Field(
        True,
        description="If True, skip clusters that already have relations (resume mode)",
    )
    parallel_workers: int | None = Field(None, description="Number of parallel workers; default from config (e.g. 5)")


def _resolve_csv_path(csv_path: str | None, raw_dir: Path) -> Path:
    """Resolve csv_path to absolute path under raw_dir. Default: polymarket_markets.csv."""
    name = (csv_path or "polymarket_markets.csv").strip()
    if not name:
        name = "polymarket_markets.csv"
    # Prevent path traversal
    if ".." in name or name.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid csv_path")
    return (raw_dir / name).resolve()


def _raw_data_dir_absolute() -> Path:
    """Return absolute path to data/raw (for uploads and resolving csv_path)."""
    from semantic_agent.config import get_settings
    s = get_settings()
    base = s.data_dir if s.data_dir.is_absolute() else Path.cwd() / s.data_dir
    return (base / s.raw_data_dir.name).resolve()


# --- Startup: install log buffer ---

@app.on_event("startup")
def startup():
    import logging
    from semantic_agent.logging_utils import configure_logging
    from admin.server.log_buffer import install_buffer_handler
    configure_logging()
    install_buffer_handler()


# --- Logs ---

@app.get("/api/logs")
def api_get_logs(tail: int = 500):
    """Return last `tail` log lines (newest last)."""
    from admin.server.log_buffer import get_logs as get_log_lines
    if tail < 1 or tail > 5000:
        tail = 500
    return {"lines": get_log_lines(tail=tail)}


@app.delete("/api/logs")
def api_clear_logs():
    """Clear the in-memory log buffer."""
    from admin.server.log_buffer import clear_logs as clear_log_buffer
    clear_log_buffer()
    return {"ok": True}


# --- Datasets (upload) ---

ALLOWED_CSV_NAME = re.compile(r"^[a-zA-Z0-9_.-]+\.csv$")
MAX_UPLOAD_MB = 500


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """Upload a CSV file to data/raw. Filename must be safe (alphanumeric, dots, underscores, hyphen)."""
    if not file.filename or not ALLOWED_CSV_NAME.match(file.filename):
        raise HTTPException(status_code=400, detail="Filename must be a safe .csv name (e.g. my_data.csv)")
    raw_dir = _raw_data_dir_absolute()
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / file.filename
    size = 0
    with open(path, "wb") as f:
        while chunk := await file.read(64 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_MB} MB)")
            f.write(chunk)
    return {"filename": file.filename, "path": str(path), "size_bytes": size}


@app.get("/api/datasets")
def list_datasets():
    """List CSV filenames in data/raw."""
    raw_dir = _raw_data_dir_absolute()
    if not raw_dir.exists():
        return {"files": []}
    files = sorted(p.name for p in raw_dir.iterdir() if p.suffix.lower() == ".csv")
    return {"files": files}


# --- Pipeline (each step + run-full) ---

def _db_url():
    from semantic_agent.config import get_settings
    return get_settings().database_url


@app.post("/api/pipeline/reset")
def pipeline_reset():
    """Clear Chroma and derived SQLite data (clusters, relations)."""
    from semantic_agent.pipeline.reset import run_reset
    run_reset(_db_url())
    return {"ok": True}


@app.post("/api/pipeline/ingest")
def pipeline_ingest(body: IngestBody | None = None):
    """Ingest from CSV into SQLite. Body: csv_path (optional), nrows (optional)."""
    from semantic_agent.config import get_settings
    from semantic_agent.pipeline.ingest import load_from_csv_and_save
    body = body or IngestBody()
    raw_dir = _raw_data_dir_absolute()
    csv_path = _resolve_csv_path(body.csv_path, raw_dir)
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail=f"CSV not found: {csv_path}")
    s = get_settings()
    markets = load_from_csv_and_save(
        csv_path,
        s.database_url,
        source_label="csv",
        min_duration_days=s.min_duration_days,
        require_resolved=False,
        require_binary=True,
        nrows=body.nrows,
    )
    return {"ok": True, "markets_loaded": len(markets)}


@app.post("/api/pipeline/embed")
def pipeline_embed():
    """Generate embeddings and store in ChromaDB."""
    from semantic_agent.pipeline.embed import run_embed_and_store
    n = run_embed_and_store(_db_url())
    return {"ok": True, "markets_embedded": n}


@app.post("/api/pipeline/cluster")
def pipeline_cluster():
    """Run K-means clustering and persist assignments."""
    from semantic_agent.pipeline.cluster import run_cluster_and_store
    clusters = run_cluster_and_store(_db_url())
    return {"ok": True, "clusters": len(clusters)}


@app.post("/api/pipeline/label")
def pipeline_label():
    """Label clusters via LLM."""
    from semantic_agent.pipeline.label import run_label_clusters
    run_label_clusters(_db_url())
    return {"ok": True}


@app.post("/api/pipeline/relations")
def pipeline_relations(body: RelationsBody | None = None):
    """Discover relations per cluster via LLM. Body: skip_clusters_with_relations (default True), parallel_workers (optional)."""
    from semantic_agent.pipeline.relations import run_discover_relations
    body = body or RelationsBody()
    results = run_discover_relations(
        _db_url(),
        skip_clusters_with_relations=body.skip_clusters_with_relations,
        parallel_workers=body.parallel_workers,
    )
    return {"ok": True, "clusters_written": len(results), "by_cluster": results}


@app.post("/api/pipeline/evaluate")
def pipeline_evaluate():
    """Evaluate predicted relations against resolved outcomes."""
    from semantic_agent.pipeline.evaluate import run_evaluate_relations, EvalResult
    result: EvalResult = run_evaluate_relations(_db_url())
    return {
        "ok": True,
        "total_relations": result.total_relations,
        "total_evaluable": result.total_evaluable,
        "total_correct": result.total_correct,
        "accuracy": result.accuracy,
        "by_cluster": {k: {"n": v.n, "correct": v.correct, "accuracy": v.accuracy} for k, v in result.by_cluster.items()},
        "by_confidence_bucket": {k: {"n": v.n, "correct": v.correct, "accuracy": v.accuracy} for k, v in result.by_confidence_bucket.items()},
    }


@app.post("/api/pipeline/run-full")
def pipeline_run_full(body: RunFullBody | None = None):
    """Reset, ingest, embed, cluster, label, relations, evaluate. Body: csv_path, nrows (optional)."""
    from semantic_agent.config import get_settings
    from semantic_agent.pipeline.run_full import run_full_pipeline
    body = body or RunFullBody()
    raw_dir = _raw_data_dir_absolute()
    csv_path = _resolve_csv_path(body.csv_path, raw_dir) if body.csv_path else None
    if csv_path is not None and not csv_path.exists():
        raise HTTPException(status_code=404, detail=f"CSV not found: {csv_path}")
    try:
        result = run_full_pipeline(csv_path=csv_path, nrows=body.nrows)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "ok": True,
        "total_evaluable": result.total_evaluable,
        "accuracy": result.accuracy,
        "total_relations": result.total_relations,
        "total_correct": result.total_correct,
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}
