# VeriBond Semantic Agent

Multi-agent pipeline for prediction market (Polymarket) clustering and relationship discovery. Supports MCP tools and RAG.

## Setup

### 1. Python 3.11+

Ensure Python 3.11 or 3.12 is installed:

```bash
python3 --version
```

### 2. Virtual environment

From the **VeriBond repo root**:

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -U pip
pip install -r requirements.txt
```

For development (lint, format, type-check, tests):

```bash
pip install -e ".[dev]"
```

### 4. Environment (optional)

Copy `.env.example` to `.env` and set API keys and paths:

```bash
cp .env.example .env
# Edit .env: OPENAI_API_KEY, POLYMARKET_API_BASE, etc.
```

Defaults work for local runs (SQLite, local data dirs).

### 5. Getting the data (not in repo)

Raw CSVs and the processed database are **not** committed. Get the data and run ingest locally:

1. **Download Polymarket data from Kaggle**
   - Dataset: [Polymarket Prediction Markets](https://www.kaggle.com/datasets/ismetsemedov/polymarket-prediction-markets)
   - You need a Kaggle account and the [Kaggle API](https://github.com/Kaggle/kaggle-api) set up (e.g. `~/.kaggle/kaggle.json`), or download the ZIP from the dataset page.
   - Place the CSV(s) in `data/raw/`. Required for ingest: **`polymarket_markets.csv`** (and optionally `polymarket_events.csv` for future use).

2. **Run ingest** (from repo root with venv activated):

```bash
export PYTHONPATH=.
python -c "
from semantic_agent.config import get_settings
from semantic_agent.pipeline.ingest import load_from_csv_and_save
s = get_settings()
m = load_from_csv_and_save(
    'data/raw/polymarket_markets.csv',
    s.database_url,
    source_label='csv',
    min_duration_days=s.min_duration_days,
    require_resolved=False,
    require_binary=True
)
print(len(m), 'markets loaded and saved.')
"
```

3. Markets are written to **`data/processed/veribond_semantic.db`** (SQLite). You can limit the first run with `nrows=20000` for a quick test.

### 6. Stage 2: Embed and cluster (after ingest)

From repo root with venv activated:

**Embed** — generate embeddings and store in ChromaDB:

```bash
export PYTHONPATH=.
python -c "
from semantic_agent.config import get_settings
from semantic_agent.pipeline.embed import run_embed_and_store
s = get_settings()
n = run_embed_and_store(s.database_url)
print(n, 'markets embedded and stored in Chroma.')
"
```

**Cluster** — run K-means on embeddings and persist cluster assignments:

```bash
export PYTHONPATH=.
python -c "
from semantic_agent.config import get_settings
from semantic_agent.pipeline.cluster import run_cluster_and_store
s = get_settings()
clusters = run_cluster_and_store(s.database_url)
print(len(clusters), 'clusters written to DB.')
"
```

Embeddings live in **`data/processed/chroma/`**; cluster assignments are in the same SQLite DB (`clusters` and `market_clusters` tables). Config: `embedding_model`, `embed_batch_size`, `chroma_collection_name`, `cluster_ratio` (K ≈ N × cluster_ratio).

### 7. Stage 3: Label clusters (LLM)

This assigns each cluster a single category (taxonomy) and writes it back to SQLite (`clusters.category`, `clusters.label_rationale`).

1. Configure in **`.env`** (repo root):
   - **OpenAI:** set `VERIBOND_OPENAI_API_KEY` to your OpenAI key. Leave `VERIBOND_OPENAI_API_BASE` unset.
   - **OpenRouter:** set `VERIBOND_OPENAI_API_KEY` to your OpenRouter key and `VERIBOND_OPENAI_API_BASE=https://openrouter.ai/api/v1`.

2. Run labeling (defaults: label up to 200 clusters, sample 20 questions per cluster):

```bash
export PYTHONPATH=.
python -c "
from semantic_agent.config import get_settings
from semantic_agent.pipeline.label import run_label_clusters
s = get_settings()
labels = run_label_clusters(s.database_url)
print(len(labels), 'clusters labeled.')
"
```

You can override limits per run:
- `run_label_clusters(..., max_clusters=50, sample_size=25)`

## Project layout

```
semantic_agent/
  config.py           # Settings (pydantic-settings)
  models/             # Market, Cluster, MarketRelation
  pipeline/           # Ingest, embed, cluster, label, relationship discovery, evaluate
  api/                # FastAPI app and routes
  mcp/                # MCP server and tools
```

Data (from repo root):

```
data/
  raw/                # Kaggle CSV(s), API responses
  processed/          # markets.parquet, DB, embeddings
```

## Run

### Ingest (after getting data)

See **Getting the data** above. Then run the ingest snippet; markets are saved to `data/processed/veribond_semantic.db`.

### Embed and cluster (after ingest)

See **Stage 2** above. Run embed first (writes to Chroma), then cluster (reads Chroma, writes clusters to SQLite).

### Tests

```bash
# From repo root
export PYTHONPATH=.
pytest tests/ -v
```

### Lint and format

```bash
ruff check semantic_agent tests
black semantic_agent tests
mypy semantic_agent
```

## Next steps

- Cluster labeling (LLM): assign category per cluster (politics, crypto, sports, …).
- Relationship discovery (LLM): per-cluster relation pairs (same/opposite outcome).
- Evaluation and API / MCP server.
