# Optimization and Next Stages — Analysis and Plan

This doc digests the research you shared, aligns it with the codebase, and proposes a concrete implementation order. It’s the basis for “what to do next” after the 83.6% run.

---

## 1. Where the research is right (and we agree)

### 1.1 What you proved

- **Prompt + incentives fixed the main failure mode.** “Prove relations or say nothing” (NO_RELATION, shared_event, confidence ≥ 0.6) doubled accuracy. The system wasn’t weak; it was under-constrained.
- **Precision over recall was correct.** 335 high-quality relations beat 1,439 noisy ones. For trading, false positives cost more than missed opportunities.
- **83.6% is research-grade.** You’re no longer debugging fundamentals; you’re optimizing a working system. Foundation is solid.

### 1.2 Embeddings as the next structural lever

- **Agree:** MiniLM is likely the main remaining ceiling. Better embeddings → purer clusters → better relation candidates. Research says “plateau 85–88% with MiniLM” and “90%+ with OpenAI embeddings.”
- **Nuance:** We don’t yet have A/B proof that embeddings are the bottleneck *at current scale*. The big jump came from the prompt. So:
  - **Do plan for OpenAI embeddings** (and cache). It’s the highest-leverage upgrade.
  - **Do it as an experiment:** same pipeline, swap embedder, measure accuracy + (if possible) cluster coherence. Don’t assume 90% without measuring.
- **Cache is mandatory:** 168k+ markets × API cost and latency. Cache by (market_id, text_hash) so re-runs and incremental ingest don’t re-call.

### 1.3 Candidate filtering before more LLM

- **Agree:** “Bad pairs → removed; good pairs → judged” is first-order. Subclusters and verification are second-order.
- **Today:** Relations step gets (cluster, list of markets) from the DB and sends the full list to the LLM. It does **not** use Chroma or embeddings.
- **To add cosine filter:** We must load embeddings from Chroma in the relations step (by market ids per cluster), compute pairwise cosine within cluster, then either:
  - **Option A (pairwise mode):** Only send *pairs* above a similarity threshold to the LLM (e.g. “Is this pair SAME/OPPOSITE/NO_RELATION?”). Fewer tokens, clearer task, but we need to batch pairs per request (e.g. 20–40 pairs per call).
  - **Option B (softer filter):** Keep “LLM proposes from list” but drop markets that have no other market in the cluster with cos_sim above threshold (outlier removal). Simpler, less invasive.
- **Recommendation:** Start with **Option B** (filter outlier markets per cluster). If we want to go further, add Option A (pairwise candidate list + batched judgment).

### 1.4 Time overlap

- **Agree:** Apply only when **both** markets have non-null `start_time`/`end_time`. If either is missing (e.g. CSV-only), allow the pair. Otherwise we’d drop a large fraction of data.
- **Rule:** `if both have dates and intervals do not overlap → exclude pair (or down-rank); else allow.`

### 1.5 Outcome filter (before storing)

- **Agree:** Before writing a relation, if both markets are resolved, check that the predicted relation type matches outcomes (SAME → same outcome; OPPOSITE → opposite). If not, discard. We already have the data; it’s a small check in the write path.
- **Note:** We already *evaluate* only relations where both are resolved. The outcome filter would **prevent storing** relations that would be wrong—so it reduces stored noise and improves precision.

### 1.6 Composite confidence

- **Agree:** Combine LLM confidence with cosine similarity and (when available) time/outcome agreement. Use for ranking “best” relations and for thresholds. Implement after we have cosine (and optionally time) in the relations path.

### 1.7 Claude and verification later

- **Agree:** Keep OpenAI as baseline. Add Claude only after: prompt stable, filters in place, baseline >80%. Otherwise we’re optimizing noise. Self-verification (second LLM pass) is a later step if we still need a bump.

### 1.8 Invalid JSON / retry

- **Agree:** ~10 clusters lost to bad JSON is not catastrophic. But retry/repair is low effort: we already have `retry_llm` for rate limits. Add one retry on parse failure, or a simple repair (e.g. strip markdown, take first `{...}`). Medium priority.

---

## 2. Data vs training vs execution (clarification)

Your question: “We train on historical resolved data; how does real-time data help?”

- **Training / eval (what we do now):** Use only **resolved** data. Relations and accuracy stay grounded. No change here.
- **Real-time (CLOB, live prices):** Not for training labels. For:
  - **Execution:** When we have “best relations,” we need order book and liquidity to know *whether* and *how* to trade.
  - **Future training:** Today’s live data becomes tomorrow’s resolved history. Storing it builds a growing dataset for future runs.
  - **Backtest:** “Would this agent have made money?” requires historical prices and depth, which come from stored live data.
- **Price history (historical):** If we can get **historical** prices for *resolved* markets (e.g. from an archive or Polymarket history), we can add features: lead-lag, correlation, volatility. That enriches **training-time** features (composite confidence, better filters) without mixing in unresolved outcomes.

So:

- **Phase 1 (optimization):** Improve accuracy and robustness on current resolved pipeline: embeddings, filters, outcome filter, composite confidence, JSON retry.
- **Phase 2 (data for execution):** CLOB client + live (or historical) price storage for execution and backtest. Not for changing how we train relations.
- **Phase 3 (data for training):** More resolved sources, historical price series for resolved markets, cross-platform resolved markets—to grow and enrich the training set.

---

## 3. Where I’d nuance the research

### 3.1 “OpenAI embeddings → 90%+”

- Plausible but not guaranteed. We should **measure**. Same pipeline, same eval, swap embedder, report accuracy and (if easy) cluster metrics. If we get 88% with MiniLM and 91% with OpenAI, we know the gain. If it’s 84% → 85%, we know embeddings weren’t the main bottleneck.

### 3.2 “Cosine + time do 80% of the work”

- Agree that token-overlap filter is marginal. Cosine + time are the main pre-filters. We can skip heavy NER or complex entity overlap for v1.

### 3.3 Order: embeddings first vs filters first

- **Research:** “OpenAI embeddings + cache → cosine filter → outcome filter → composite confidence.”
- **PIPELINE_OPTIMIZATION_VALIDATION.md (existing):** “Pre-filters (cos_sim + time) → outcome filter → OpenAI embeddings → composite confidence.”
- **My take:** Filters (cosine, time, outcome) don’t require new infra; they use existing Chroma + DB. Embeddings require a new code path + cache. So:
  - **Option 1:** Filters first → measure gain → then embeddings → measure again. Clear attribution.
  - **Option 2:** Embeddings first → then filters. Bigger one-time change; harder to attribute.
- **Recommendation:** **Filters first** (cosine + time + outcome), then **OpenAI embeddings + cache**, then **composite confidence**. That way we see “prompt + filters” vs “+ embeddings” separately.

---

## 4. Implementation order (phased plan)

### Phase 1 — Filters and robustness (no new embedder)

| Step | What | Why |
|------|------|-----|
| 1.1 | **Cosine pre-filter in relations** | Use Chroma to load embeddings by market id per cluster; compute pairwise cosine; drop pairs (or outlier markets) below threshold. Config: `relations_min_cosine_sim` (default e.g. 0.3 or 0.4). Only when Chroma exists and cluster has embeddings. |
| 1.2 | **Time-overlap filter** | When both markets have `start_time` and `end_time`, require overlap (or max gap). Config: `relations_require_time_overlap` (bool), `relations_max_start_gap_days` (float). If either market missing dates → allow. |
| 1.3 | **Outcome filter before write** | Before storing a relation, if both markets resolved: check SAME → same outcome, OPPOSITE → opposite. If mismatch, skip. Config: `relations_outcome_filter` (bool, default True). |
| 1.4 | **JSON retry/repair in relations** | On parse failure, retry once (e.g. “Output only valid JSON.”) or try repair (strip markdown, extract first `{...}`). Log and skip only after retry/repair fails. |

**Deliverable:** Same pipeline, filters + outcome check + JSON retry. Measure: accuracy, relation count, evaluable count, and (if possible) accuracy-by-confidence bucket.

---

### Phase 2 — Embeddings upgrade

| Step | What | Why |
|------|------|-----|
| 2.1 | **OpenAI embedder path in `embed.py`** | Branch on config (e.g. `embedding_provider: local | openai`). If openai: call Embeddings API, respect `embedding_model` (e.g. text-embedding-3-small/large) and dimension. |
| 2.2 | **Embedding cache** | Cache by (market_id, text_hash) in SQLite or alongside Chroma. On re-run or new markets, only embed uncached. Reduces cost and latency after first run. |
| 2.3 | **Chroma + cluster compatibility** | Cluster step already reads from Chroma; it doesn’t care if vectors came from MiniLM or OpenAI. Ensure dimension is consistent (OpenAI 1536/3072 vs MiniLM 384): cluster and relations must use same dimension. So “embed with OpenAI” implies “re-embed all and re-cluster” when switching. |
| 2.4 | **A/B comparison** | Run same pipeline twice (MiniLM vs OpenAI, same data slice if needed). Record accuracy, relation count, and eval metrics. Document in PIPELINE_OVERVIEW or a short “Embedding comparison” note. |

**Deliverable:** Optional OpenAI embeddings + cache; reproducible comparison vs MiniLM.

---

### Phase 3 — Confidence and ranking

| Step | What | Why |
|------|------|-----|
| 3.1 | **Composite confidence** | When we have cosine (and optionally time) in the relations path: `composite = w1*llm_conf + w2*cos_sim + w3*time_score`. Store as separate field or replace `confidence_score`. Config: weights and whether to use composite for filtering (e.g. only store if composite ≥ 0.6). |
| 3.2 | **Eval by confidence bucket** | Already have `eval_min_confidence` and `eval_confidence_buckets`. Ensure we report accuracy per bucket (e.g. 0.6–0.7, 0.7–0.8, 0.8+) so we can see where we’re strongest. |

**Deliverable:** Composite confidence in DB and eval; optional filter/ranking by composite; eval breakdown by bucket.

---

### Phase 4 — Data and execution (later)

| Step | What | Why |
|------|------|-----|
| 4.1 | **CLOB client** | Fetch order book / ticker per market (Polymarket CLOB). For execution and backtest, not for changing relation training. Schema: e.g. `order_books(market_id, bid_px, ask_px, ts)` or similar. |
| 4.2 | **Price history (historical)** | If available, store historical prices/volume for resolved markets. Use for lead-lag and composite confidence in future. |
| 4.3 | **More resolved data** | More exports, more history, or other platforms’ resolved markets to grow training set. |

---

## 5. Open questions for you

1. **Cosine filter shape:** Prefer **Option B** (drop outlier markets per cluster so the list sent to the LLM is “tighter”) or **Option A** (pre-compute pairs above threshold and send only those pairs to the LLM in batches)? Option B is simpler and keeps current “LLM proposes from list” flow; Option A is more precise but changes the prompt and batching.
2. **Default thresholds:** For `relations_min_cosine_sim`, 0.3–0.4 is a reasonable default (avoid very unrelated pairs). For time, e.g. “allow if start dates within 90 days or intervals overlap.” Do you want stricter/looser defaults?
3. **Outcome filter default:** Should `relations_outcome_filter` be **on by default** (only store relation if resolved outcomes match prediction)? Recommendation: yes, for maximum precision.
4. **Embedding comparison scope:** When we add OpenAI embeddings, do you want a **small** A/B (e.g. 10k markets) for speed, or **full** 168k run for real comparison? Full is more representative but slower and more costly for OpenAI.

---

## 6. Summary

- **Research is aligned with the codebase:** Prompt + NO_RELATION + confidence did the heavy lifting; next levers are filters, embeddings, composite confidence, then data/execution.
- **Training stays on resolved data.** Real-time and CLOB are for execution, backtest, and future training data, not for changing how we train relations.
- **Proposed order:** Phase 1 (cosine + time + outcome filters + JSON retry) → Phase 2 (OpenAI embeddings + cache + A/B) → Phase 3 (composite confidence + eval buckets) → Phase 4 (CLOB, price history, more data).
- **Next concrete step:** Implement Phase 1 (filters + outcome filter + JSON retry), run pipeline, measure, then decide Phase 2 timing.

Once you confirm the cosine-filter shape (A vs B), default thresholds, and outcome-filter default, we can turn Phase 1 into a concrete task list and implement.

---

## 7. Task and subtask breakdown (all phases)

### Phase 1 — Filters and robustness ✅ IMPLEMENTED

| Task | Subtask | Status |
|------|---------|--------|
| 1.1 Config | Add `relations_min_cosine_sim` (0.35), `relations_require_time_overlap` (True), `relations_max_start_gap_days` (90), `relations_outcome_filter` (True) | Done |
| 1.2 Cosine filter | Option B: load Chroma per cluster, keep only markets with ≥1 neighbor above threshold; 0 = disabled | Done |
| 1.3 Time filter | `_filter_markets_by_time`: keep market if it has ≥1 temporal neighbor (overlap or start within N days); only when both have dates | Done |
| 1.4 Outcome filter | `_filter_relations_by_outcome`: before write, drop relation if both resolved and outcome contradicts prediction | Done |
| 1.5 JSON retry/repair | `_repair_json` (strip markdown, extract `{...}`); on parse failure, one retry with “Output only valid JSON” | Done |

**Config:** `semantic_agent/config.py`  
**Code:** `semantic_agent/pipeline/relations.py` (filter helpers, task building, outcome filter before write, parse retry in `discover_relations_for_cluster`).

---

### Phase 2 — Embeddings upgrade ✅ IMPLEMENTED

| Task | Subtask |
|------|---------|
| 2.1 OpenAI embedder | In `embed.py`: branch on `embedding_provider` (local \| openai); call Embeddings API when openai |
| 2.2 Embedding cache | Cache by (market_id, text_hash) in SQLite or alongside Chroma; skip re-embed for cached |
| 2.3 Dimension / re-cluster | Ensure cluster step uses same dimension; document “re-embed + re-cluster” when switching provider |
| 2.4 A/B comparison | 10k dry run then full run; record accuracy and (optional) cluster metrics (intra/inter cosine, silhouette) |
| 2.4a Cluster quality | After fit: log intra_cosine_mean, inter_cosine_mean, silhouette in `cluster.py` | Done |
| 2.4b JSON robustness | Second retry on parse failure; improved `_repair_json` (bracket fix, extract relations array) | Done |

**To run Phase 2 with OpenAI:** Set `VERIBOND_EMBEDDING_PROVIDER=openai`, `VERIBOND_EMBEDDING_MODEL=text-embedding-3-small`, `VERIBOND_EMBEDDING_DIM=1536`, `VERIBOND_OPENAI_API_KEY=...`. Then **Reset** → **Embed** → **Cluster** → **Relations** → **Eval**. Check logs for cluster quality and eval accuracy.

**If embed hits 429 (rate limit):** Embed now retries each batch with backoff and uses a small delay between batches (`embedding_openai_delay_between_batches_seconds`, default 0.5s). If you still see "Pipeline step [embed] failed" and then 0 accuracy, Chroma was never written—run **Embed** again (no Reset); cache will skip already-embedded markets so only the remainder is sent to the API.

---

### Phase 3 — Composite confidence and eval (after Phase 2)

| Task | Subtask |
|------|---------|
| 3.1 Composite confidence | `composite = w1*llm_conf + w2*cos_sim + w3*time_score`; store and/or use for filtering |
| 3.2 Eval by bucket | Report accuracy per confidence bucket (e.g. 0.6–0.7, 0.7–0.8, 0.8+); ensure `eval_confidence_buckets` used |

---

### Phase 4 — Data and execution (later)

| Task | Subtask |
|------|---------|
| 4.1 CLOB client | Fetch order book / ticker per market (Polymarket CLOB); schema e.g. `order_books(market_id, bid_px, ask_px, ts)` |
| 4.2 Price history | Store historical prices/volume for resolved markets when available; use for lead-lag / composite |
| 4.3 More resolved data | Additional exports, history, or platforms to grow training set |
