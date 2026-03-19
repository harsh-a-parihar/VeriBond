# VeriBond Pipeline – Overview and This Run

## 1. This run – summary (Gamma + CSV, with Phase 1 filters)

| Metric | Value |
|--------|--------|
| **Ingest** | 169,184 markets (CSV + Gamma) |
| **Embed** | 169,184 embedded (all-MiniLM-L6-v2) |
| **Cluster** | 200 clusters (MiniBatchKMeans) |
| **Label** | 200 clusters labeled (GPT-4o-mini) |
| **Relations** | **431** relations written (100 clusters processed) |
| **Evaluate** | **303 evaluable, 303 correct → 100% accuracy** |

**Notable:** Phase 1 filters are on (cosine Option B, time overlap, **outcome filter**). With **outcome filter enabled**, we do not store any relation where both markets are resolved and the LLM prediction contradicts the actual outcomes. So every **evaluable** relation we store has already passed that check—meaning **reported accuracy on evaluable relations is 100% by construction**. This is consistency of stored relations with outcomes, not raw LLM prediction accuracy. See [§1.1 Why 100% accuracy with the outcome filter](#11-why-100-accuracy-with-the-outcome-filter) below.

Previous run (same pipeline, **no** outcome filter): 335 relations, 225 evaluable, 188 correct → **83.6% accuracy** (true LLM accuracy on that subset).

### 1.1 Why 100% accuracy with the outcome filter

With **Phase 1** we added `relations_outcome_filter = True` (default). Before writing a relation to the DB we:

- For each relation, check both markets’ `resolved_outcome`.
- If **both** are resolved (YES/NO), we only **store** the relation if the prediction matches: SAME_OUTCOME ↔ same actual outcomes, OPPOSITE_OUTCOME ↔ opposite actual outcomes.
- If the prediction contradicts the outcomes, we **drop** that relation and do not store it.

So **every stored relation that is evaluable** (both markets resolved) has already passed this check. When the Evaluate stage runs, it only sees stored relations—and for evaluable ones, we kept only those that already matched. So:

- **Evaluable accuracy = 100%** is **by construction**: we removed all wrong ones before storing.
- The metric is **“consistency of stored relations with resolved outcomes”**, not **“raw LLM prediction accuracy.”**

To measure **raw LLM accuracy** again (e.g. to compare prompt or model changes), run with the outcome filter **off**: set `VERIBOND_RELATIONS_OUTCOME_FILTER=false`, run Relations + Evaluate, and compare evaluable accuracy. The outcome filter is still useful for **production**: it keeps the stored graph free of known contradictions and is the right default for “best trades.”

**Chroma telemetry errors in logs:** During the relations step you may see many `chromadb.telemetry.product.posthog ... capture() takes 1 positional argument but 3 were given`. These come from Chroma’s optional telemetry and do not affect correctness or performance; they can be ignored or suppressed via Chroma’s settings.

---

## 2. Difference from previous runs – what changed and why

### Previous runs (before this change)

| Run | Data | Relations | Evaluable | Correct | Accuracy |
|-----|------|-----------|-----------|---------|----------|
| Gamma + CSV (earlier) | 176,208 markets | 1,439 | 569 | 240 | **~42%** |
| CSV-only (earliest) | ~100k CSV | — | — | — | **~60%** |

### This run (after new relations prompt)

| Run | Data | Relations | Evaluable | Correct | Accuracy |
|-----|------|-----------|-----------|---------|----------|
| CSV only (Gamma timed out) | 100,766 | 373 | 238 | 191 | **~80.3%** |
| Gamma + CSV (no outcome filter) | 168,601 | 335 | 225 | 188 | **~83.6%** |
| **Gamma + CSV (Phase 1 filters, outcome filter ON)** | **169,184** | **431** | **303** | **303** | **100%*** |

\* With outcome filter on, evaluable accuracy is 100% by construction (see §1.1). Use `VERIBOND_RELATIONS_OUTCOME_FILTER=false` to measure raw LLM accuracy.

### What changed in code

1. **New relations prompt (research-style)**  
   - **Before:** “Propose up to N pairs whose outcomes are related” → model tended to output many pairs, including weak ones.  
   - **After:** “Identify ONLY verifiable outcome dependencies. If unclear → NO_RELATION. Require shared real-world event and evidence. Confidence < 0.6 → NO_RELATION.”  
   - **Effect:** Model is conservative; fewer relations, but mostly high-confidence, grounded ones.

2. **Post-parse filtering**  
   - We **drop** any relation with `relation_type == "NO_RELATION"` or `confidence < 0.6`.  
   - Only SAME_OUTCOME / OPPOSITE_OUTCOME with confidence ≥ 0.6 are stored.  
   - **Effect:** Low-confidence and “no relation” answers are not counted, so precision goes up.

3. **Optional shared_event**  
   - We ask for and store `shared_event` (and still require it in the prompt).  
   - **Effect:** Encourages the model to ground relations in a concrete event; helps avoid vague links.

### Why accuracy jumped (42% → 80%)

- **Precision over recall:** Old prompt maximized “find relations” → many wrong pairs. New prompt maximizes “only output when you’re sure” → fewer but correct pairs.  
- **NO_RELATION and confidence cutoff:** Uncertain or weak pairs are not stored, so evaluable relations are a cleaner set.  
- **Data:** This run was CSV-only (Gamma failed). Single source can be more consistent than Gamma+CSV merge; that may help, but the main driver is the **prompt + filtering**, not just the data source.

So: **what changed** = new conservative prompt + NO_RELATION + confidence ≥ 0.6 filter. **Why** = we trade total number of relations for higher correctness on the ones we keep.

---

## 3. Pipeline overview – stages and process

End-to-end: **Reset → Ingest → Embed → Cluster → Label → Relations → Evaluate**.

---

### Stage 0: Reset (optional, run at start of full pipeline)

**What it does:** Clears derived data so the next run starts from a clean state.

**Process:**
- Deletes or truncates: `relations`, `market_clusters`, `clusters` in SQLite.
- Deletes Chroma collection (embeddings) if it exists.
- Does **not** delete the `markets` table; ingest reuses or overwrites it.

**Inputs:** DB URL, Chroma path (from config).  
**Outputs:** Empty relations, clusters, market_clusters, and Chroma collection.

---

### Stage 1: Ingest

**What it does:** Loads market data from external sources into the `markets` table.

**Process:**
- **Gamma (optional):** HTTP GET to Polymarket Gamma API (`/events?closed=true`), paginated. Parses events and nested markets into `Market` (id, question, description, start/end time, resolved_outcome, etc.). Merged by market id.
- **CSV (optional):** Reads a CSV (e.g. Polymarket export) from `data/raw/`. Maps columns (question, tokens, outcomePrices, etc.) to `Market`. Filters: binary only, optional min_duration_days, optional require_resolved.
- **Merge:** Combines Gamma + CSV by market id (last write wins for conflicts). Writes all markets to SQLite `markets` table. Schema is created if missing.

**Inputs:** DB URL, CSV path (optional), Gamma on/off, gamma_max_pages, nrows (for CSV).  
**Outputs:** SQLite `markets` table populated (e.g. 100k+ rows).

---

### Stage 2: Embed

**What it does:** Turns each market’s text (question + description) into a vector and stores it in Chroma.

**Process:**
- Reads all markets from SQLite.
- Builds text per market: `question` + optional `description`.
- **Local path:** Uses `sentence_transformers.SentenceTransformer` (e.g. `all-MiniLM-L6-v2`). Encodes in batches (e.g. 64), no API call.
- Produces one vector per market (e.g. 384-dim for MiniLM).
- Creates or gets Chroma collection; upserts (id, document, embedding) in chunks (e.g. 500–1000 per chunk).

**Inputs:** DB URL, Chroma path, embedding model name, batch size (from config).  
**Outputs:** Chroma collection filled with market id, text, and embedding vector.

---

### Stage 3: Cluster

**What it does:** Groups markets into topical clusters using their embeddings.

**Process:**
- Reads all markets from SQLite; gets their embeddings from Chroma (by market id).
- Runs **MiniBatchKMeans** on the embedding matrix. K = min(floor(N × cluster_ratio), max_clusters) (e.g. ratio 0.1, max 200 → 200 clusters for 100k markets).
- Each market is assigned one cluster id (e.g. c_0, c_1, …).
- Writes `clusters` table (cluster_id, category placeholder, label_rationale null) and `market_clusters` table (cluster_id, market_id).

**Inputs:** DB URL, cluster_ratio, max_clusters (from config).  
**Outputs:** SQLite `clusters` and `market_clusters` populated.

---

### Stage 4: Label

**What it does:** Assigns a human-readable category to each cluster using an LLM.

**Process:**
- Reads clusters and their market_ids; for each cluster, loads the corresponding markets and takes a random sample of questions (e.g. 20).
- For each cluster, one **OpenAI chat** call: “Given these questions, pick one category from [politics, macro, finance, crypto, tech, sports, culture, other]. Return JSON: category, label_rationale.”
- Runs in parallel (e.g. 5 workers). Temperature 0 (and optional response_format json_object).
- Updates `clusters` with `category` and `label_rationale`.

**Inputs:** DB URL, OpenAI API key, model (e.g. gpt-4o-mini), label_sample_size, label_parallel_workers (from config).  
**Outputs:** `clusters` table updated with category and rationale.

---

### Stage 5: Relations

**What it does:** For each labeled cluster, the LLM proposes **pairs of markets** that have a verifiable outcome relationship (same or opposite). Only high-confidence, grounded relations are stored. **Phase 1 filters** (cosine Option B, time overlap, outcome filter) run before and after the LLM.

**Process:**
- Reads clusters (optionally only those with non-“other” category). Skips clusters that already have relations if resume mode is on. Respects `relations_excluded_clusters_csv` if set.
- For each cluster, loads its markets (by market_ids), capped at max_markets_per_cluster (e.g. 100).
- **One LLM call per cluster:** Sends the new conservative prompt:
  - “Identify ONLY verifiable outcome dependencies. If unclear → NO_RELATION. Require shared real-world event. Confidence < 0.6 → NO_RELATION.”
  - Asks for JSON: `relations[]` with `market_id_i`, `market_id_j`, `relation_type` (SAME_OUTCOME | OPPOSITE_OUTCOME | NO_RELATION), `confidence`, `shared_event`, `rationale`.
- **Phase 1 pre-filters (before LLM):** Cosine (Option B): drop markets with no neighbor in cluster above `relations_min_cosine_sim` (Chroma). Time: drop markets with no temporal neighbor when `relations_require_time_overlap` (only when both have dates).
- **Parse and filter:** Drops NO_RELATION and confidence < 0.6. Maps SAME_OUTCOME → `is_same_outcome=True`, OPPOSITE_OUTCOME → `is_same_outcome=False`. Fills `question_i` / `question_j` from cluster markets if missing. On parse failure, one JSON retry.
- **Phase 1 outcome filter (before write):** If `relations_outcome_filter` (default True), drop any relation where **both** markets are resolved and the prediction contradicts outcomes. **Effect:** Stored evaluable relations are consistent by construction; reported accuracy on evaluable will be 100% when this filter is on (see §1.1).
- Deduplicates by (market_id_i, market_id_j). Writes to `relations` table (cluster_id, market_id_i, market_id_j, question_i, question_j, is_same_outcome, confidence_score, rationale, shared_event).
- Runs in parallel (e.g. 5 workers). Invalid JSON after retry → 0 relations for that cluster.

**Inputs:** DB URL, OpenAI API key, model, Chroma path (cosine filter), relations_min_cosine_sim, relations_require_time_overlap, relations_max_start_gap_days, relations_outcome_filter (from config).  
**Outputs:** SQLite `relations` table filled with 0–N relations per cluster; total e.g. 431.

---

### Stage 6: Evaluate

**What it does:** Measures how well predicted relations match actual resolved outcomes (same/opposite).

**Process:**
- Reads all relations and all markets from SQLite.
- For each relation, looks up `resolved_outcome` for market_id_i and market_id_j. If both are YES/NO, the relation is **evaluable**.
- **Ground truth:** Same outcome = both YES or both NO. Opposite = one YES, one NO.
- **Prediction:** `is_same_outcome=True` → same; `False` → opposite.
- **Correct:** Prediction matches ground truth. Accuracy = correct / evaluable (e.g. 191/238 = 80.3%).
- Optionally filters by `min_confidence` (e.g. 0.85) and reports accuracy on that subset.

**Inputs:** DB URL, optional min_confidence_override.  
**Outputs:** EvalResult (total_relations, total_evaluable, total_correct, accuracy, optional by_cluster / by_confidence_bucket).

---

## 4. Data flow (summary)

```
data/raw/*.csv + Gamma API (optional)
        → Ingest → markets (SQLite)
        → Embed  → Chroma (id, document, embedding)
        → Cluster → clusters + market_clusters (SQLite)
        → Label  → clusters updated (category, rationale)
        → Relations → relations (SQLite); LLM uses conservative prompt + NO_RELATION + confidence ≥ 0.6
        → Evaluate → accuracy vs resolved outcomes
```

**Artifacts:**  
- `data/processed/veribond_semantic.db`: markets, clusters, market_clusters, relations.  
- `data/processed/chroma/`: vector store for embeddings.

---

## 5. Takeaways from this run

- **100% evaluable accuracy** with Phase 1 is **by construction** when the **outcome filter** is on: we only store relations that agree with resolved outcomes when both markets are resolved. So the reported metric is "consistency of stored relations," not raw LLM accuracy. See §1.1.
- **Raw LLM accuracy** (without outcome filter) was **~83.6%** on the previous run. To measure it again, set `VERIBOND_RELATIONS_OUTCOME_FILTER=false`.
- **Phase 1 filters** (cosine Option B, time overlap, outcome filter, JSON retry) are on by default; outcome filter is the right default for "best trades."
- **Fewer relations** (e.g. 335–431 vs 1,439 historically) is expected and desired when optimizing for precision.
- **Invalid JSON** on a cluster (e.g. c_20) still zeroes that cluster after one retry.
- **Chroma telemetry** errors in logs are harmless and can be ignored.

---

## 6. Why Gamma can time out (and what we did)

The Gamma API (`gamma-api.polymarket.com`) can fail or be slow because of:

- **Network:** Long latency, firewall, or DNS delays.
- **Server:** Polymarket rate-limiting or slow responses.
- **Single long timeout:** Previously we used one 30s timeout; the **connect** phase alone can exceed that.

**Changes made:**

- **Longer timeouts:** Connect = 60s, read = 90s per request.
- **Retries:** Up to 3 attempts per page with exponential backoff (5s, 10s, 20s). One slow or failed request no longer aborts the whole Gamma fetch.
- **Ingest logging:** After merge we log `Merged N markets (CSV=X, Gamma=Y)` so you can confirm both sources contributed.

If Gamma still fails after retries, the pipeline continues with CSV-only; you’ll see `Gamma: fetched 0 unique markets` and `CSV=X, Gamma=0` in the logs.

---

## 7. Run with Gamma + CSV (what to do)

We **always** want to run with **both** CSV and Gamma when possible, then record the result here.

### What you need

1. **CSV** at `data/raw/polymarket_markets.csv` (or the path you pass).
2. **Network** that can reach `https://gamma-api.polymarket.com` (no VPN blocking, etc.).
3. **Full pipeline** with **use_all_sources = True** (default).

### Steps

1. **Validate Gamma connectivity (recommended if you’ve seen timeouts):**  
   Run `python scripts/check_gamma_api.py` (or `--timeout 30`). If it times out, the problem is network; see [Gamma API validation](GAMMA_API_VALIDATION.md) and try `curl` from terminal or a different network. Only run the full pipeline once this check succeeds.

2. **Clear previous run (optional but recommended):**  
   Run the full pipeline once; it starts with Reset, which clears derived data (relations, clusters, Chroma). Markets are re-ingested from CSV + Gamma.

3. **Run the full pipeline with both sources:**
   - **From admin UI:** Datasets → pick CSV path if needed → **Run full pipeline** with **“Use all sources”** (Gamma + CSV) checked.
   - **From Python:**
     ```bash
     cd /Users/harsh/Documents/Projects/Open_Source/VeriBond
     source .venv/bin/activate   # or: penv
     python -c "
     from semantic_agent.pipeline.run_full import run_full_pipeline
     run_full_pipeline(use_all_sources=True, gamma_max_pages=300)
     "
     ```

4. **Check the logs** for:
   - `Loaded N markets from CSV`
   - `Gamma: fetched M unique markets` (if M > 0, Gamma succeeded)
   - `Merged T markets from all sources (CSV=X, Gamma=Y)` — **both X and Y should be > 0** when both sources are used.
   - At the end: `Eval: K evaluable, accuracy=0.XXX`

5. **Share the result:**  
   Copy the final ingest line (CSV/Gamma/merged counts) and the eval line (evaluable, accuracy). We’ll update the table below with your run.

### Result (Gamma + CSV run)

| Metric | Value |
|--------|--------|
| **Ingest** | 169,184 markets (CSV + Gamma) |
| **Embed** | 169,184 markets |
| **Cluster** | 200 clusters |
| **Label** | 200 clusters |
| **Relations** | **431** relations (Phase 1 filters on) |
| **Evaluate** | **303 evaluable, 303 correct → 100% accuracy*** |

\* With **outcome filter** on (default), evaluable accuracy is **100% by construction**: we only store relations that match resolved outcomes when both markets are resolved. See §1.1. To measure **raw LLM accuracy**, set `VERIBOND_RELATIONS_OUTCOME_FILTER=false` and re-run Relations + Evaluate.

_Result from run 2026-02-07 (Phase 1 filters); Gamma connectivity succeeded._
