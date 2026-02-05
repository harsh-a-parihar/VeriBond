# VeriBond Admin Dashboard

Minimal admin UI to run the semantic pipeline, upload CSV datasets, and view logs. **Separate from** the main `frontend/` app.

## Prerequisites

- **Repo root:** Python venv with dependencies (`pip install -r requirements.txt`), `.env` configured (see main README).
- **Admin app:** Node 18+ and npm (for the dashboard UI).

## Run the admin dashboard

### 1. Start the API server (from repo root)

```bash
cd /path/to/VeriBond
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
export PYTHONPATH=.
uvicorn admin.server.app:app --reload --host 127.0.0.1 --port 8000
```

API: `http://127.0.0.1:8000`. Docs: `http://127.0.0.1:8000/docs`.

### 2. Start the dashboard UI (in another terminal)

```bash
cd admin/app
npm install
npm run dev
```

Dashboard: `http://localhost:5173`. The app proxies `/api` to the backend (port 8000).

## Usage

- **Datasets:** Upload a CSV (saved to `data/raw/`). Select a file from the dropdown for Ingest / Run full pipeline.
- **nrows (optional):** Limit CSV rows (e.g. `50000` for a quicker run). Leave empty for full file.
- **Pipeline:** Use **Reset** to clear Chroma and derived data, then run steps in order: **Ingest** → **Embed** → **Cluster** → **Label** → **Relations** → **Evaluate**, or use **Run full pipeline** to do all at once.
- **Logs:** Shown in the right panel; auto-refreshed while an action runs. Use **Clear** / **Refresh** as needed.

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/logs?tail=500` | Last N log lines |
| DELETE | `/api/logs` | Clear log buffer |
| POST | `/api/datasets/upload` | Upload CSV (form: `file`) |
| GET | `/api/datasets` | List CSV filenames in `data/raw` |
| POST | `/api/pipeline/reset` | Clear Chroma + clusters/relations |
| POST | `/api/pipeline/ingest` | Ingest from CSV (body: `csv_path`, `nrows`) |
| POST | `/api/pipeline/embed` | Embed and store in Chroma |
| POST | `/api/pipeline/cluster` | K-means cluster |
| POST | `/api/pipeline/label` | Label clusters (LLM) |
| POST | `/api/pipeline/relations` | Discover relations (LLM) |
| POST | `/api/pipeline/evaluate` | Evaluate relations vs resolved outcomes |
| POST | `/api/pipeline/run-full` | Run full pipeline (body: `csv_path`, `nrows`) |
| GET | `/api/health` | Health check |

## Build for production (optional)

```bash
cd admin/app
npm run build
```

Serve `admin/app/dist` with your web server and keep the API on port 8000 (or mount the static files in the FastAPI app).
