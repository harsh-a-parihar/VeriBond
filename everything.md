## VeriBond – Problem, Solution, and Semantic Pipeline (Everything)

This doc explains **what problem VeriBond solves**, **how the on-chain protocol works**, and **what the semantic relations pipeline does today** – including **why** each design/optimization was made.

It is a narrative version of the existing `README.md` and `docs/*` files plus the Phase 3 notebook work.

---

## 1. Problem: Trust and Accountability for AI Agents

### 1.1 The core problem

AI agents are making more and more predictions (markets, prices, events), but:

- **No accountability**: They can be confidently wrong with no economic consequence.
- **No reliable reputation**: Off-chain “reputation” is vague, gameable, and not priced.
- **No way to price trust**: Users can’t tell which agents are consistently good vs noisy.

In finance terms: we have “signal generators” with no **skin in the game** and no **on-chain PnL**.

### 1.2 VeriBond’s high-level solution

VeriBond turns agent predictions into **staked economic bets**:

- An **agent** makes a prediction and **stakes USDC**.
- When the real-world market resolves (e.g. Polymarket), the protocol checks:
  - **Correct** → stake returned + rewards.
  - **Wrong** → stake is **slashed**, reserve burns, and the **agent’s token price drops**.
- The agent’s **token price becomes a trust signal** – a compressed, on-chain view of its historical performance.

The result:  
**Truth is profitable. Lies are expensive.**

---

## 2. On-Chain Architecture (Very Brief)

The main `README.md` covers this in detail. At a high level:

- **Identity layer (ERC‑8004)**:
  - Agent NFTs (identity registry).
  - Reputation registry (slashes, feedback).
  - Validation registry (oracle results).
  - Soulbound OwnerBadge: owners can’t hide; rugs are linkable to identities.

- **Token & Staking layer**:
  - **Uniswap v4 CCA** for fair token launch and permanent LP burn.
  - **Staking** on claims: agent stakes USDC on predictions; slashing burns reserve.

- **Payment layer**:
  - Yellow Protocol for gasless, off-chain **micropayments** (query fees).

This layer answers: **“How do we put economic weight and reputation on predictions?”**

The semantic pipeline (next sections) answers: **“What *relations/signals* should the agent put weight on?”**

---

## 3. Semantic Relations Pipeline – Purpose

VeriBond’s on-chain system needs **high-quality, structured relationships** between prediction markets. Examples:

- Two markets that clearly resolve the **same** outcome.
- Two markets where one is essentially the **opposite** of the other.

If we can discover and trust these relations, we can:

- Transfer information between related markets.
- Build trading strategies (e.g. same‑outcome and opposite‑outcome arbitrage).
- Evaluate agents on **structurally meaningful** edges, not random noise.

The semantic pipeline is an **offline research + data pipeline** that:

1. Ingests resolved prediction markets (Polymarket via CSV + Gamma).
2. Embeds and clusters them.
3. Uses an LLM to discover **SAME_OUTCOME / OPPOSITE_OUTCOME** relations within clusters.
4. Evaluates those relations against actual resolved outcomes.

We use this to:

- Build a **clean relation graph** over markets.
- Measure and improve the **semantic model’s accuracy**.
- Eventually drive **execution and backtesting** in later phases.

---

## 4. End-to-End Pipeline: Stages

The end-to-end semantic pipeline is:

**Reset → Ingest → Embed → Cluster → Label → Relations → Evaluate**

Below, for each stage:

- **What it does**
- **Why it exists**
- **Key design choices**

### 4.1 Reset

**What:** Clear derived data so the next run starts from a clean state.

- Drops/clears:
  - `relations`, `market_clusters`, `clusters` (SQLite).
  - Chroma collection (embeddings).
- Keeps:
  - `markets` table (you can reuse or overwrite).

**Why:** When you change the embedding model, clustering params, or relations prompt, you want a **clean slate** so measurements aren’t polluted by older artifacts.

---

### 4.2 Ingest

**What:** Load market data into the `markets` table from:

- **CSV exports** (historic Polymarket markets).
- **Gamma API** (`gamma-api.polymarket.com`) for live/updated markets.

**Process:**

- Fetch from Gamma with retry/backoff and larger timeouts.
- Load CSV from `data/raw/...`.
- Map fields → `Market` model:
  - `id`, `question`, `description`, `start_time`, `end_time`, `duration_days`,
  - `resolved_outcome` (YES/NO where known),
  - `is_binary`, `tags`, `slug`, `source`.
- Merge Gamma + CSV by `id`.
- Write all markets to SQLite `markets` table.

**Why:**

- We want a **large, resolved dataset** of prediction markets as ground truth.
- Gamma + CSV gives better coverage than CSV alone.
- Having resolved outcomes per market lets us **supervise** the relations step later.

**Optimizations implemented:**

- Longer HTTP timeouts and retries for Gamma, so network hiccups don’t kill the pipeline.
- Clear logs:
  - How many markets from CSV vs Gamma.
  - Merged totals.

---

### 4.3 Embed

**What:** Turn each market (question + description) into a numeric vector and store it in **Chroma**.

**Original design:**

- Local embeddings with `sentence-transformers/all-MiniLM-L6-v2` (384‑dim).

**Phase 2 upgrade (implemented):**

- **Config-driven provider**:
  - `embedding_provider = "local" | "openai"`.
  - `embedding_model`, `embedding_dim`.
- **OpenAI path:**
  - Uses `text-embedding-3-small` (1536‑dim) or similar via OpenAI Embeddings API.
  - Batches requests with backoff and delay between batches.
  - Handles 429 rate limits robustly.
- **Embedding cache:**
  - SQLite table `embedding_cache` keyed by `(market_id, text_hash, provider, model_name)`.
  - On re-run or incremental ingest, only non-cached texts are sent to the API.

**Why:**

- **Better geometry** (OpenAI) → purer clusters → better relation candidates.
- **Cache is mandatory** at Polymarket scale (100k+ markets).
- Chroma provides:
  - Persistent vector store backing cluster and relations step.

**Design choice:**  
Dimension must be consistent across pipeline:

- If you change provider/model, you **re-embed and re-cluster**.

---

### 4.4 Cluster

**What:** Group markets into topical clusters using their embeddings.

**Process:**

- Read all markets from SQLite and their embeddings from Chroma.
- Run **MiniBatchKMeans**:
  - `k = min(floor(N × cluster_ratio), max_clusters)` (e.g. 0.1 and 200 → 200 clusters for ~170k markets).
- Assign each market to one cluster id (`c_0`, `c_1`, …).
- Persist:
  - `clusters` table (cluster_id, category placeholder, label_rationale).
  - `market_clusters` table (market_id, cluster_id).
- Log **cluster quality metrics**:
  - `intra_cosine_mean`
  - `inter_cosine_mean`
  - `silhouette`

**Why:**

- Clusters are the **context windows** for relations: we only ask the LLM to compare markets within the same topical cluster.
- Good clusters mean:
  - Higher chance pairs inside are meaningfully related.
  - Less noise for the LLM to sift through.

**Design choice:**  
MiniBatchKMeans is a good trade-off:

- Scales to 100k+ markets.
- Simple, robust, and works directly in embedding space.

---

### 4.5 Label

**What:** Assign a **human-readable category** to each cluster.

**Process:**

- For each cluster:
  - Sample a subset of market questions (e.g. 20).
  - Call OpenAI chat model (e.g. `gpt-4o-mini`) with a prompt:
    - “Given these markets, classify into one of: politics, macro, finance, crypto, tech, sports, culture, other.”
  - Parse JSON output: `category`, `label_rationale`.
- Update `clusters` table with:
  - `category` (enum-like string).
  - `label_rationale`.

**Why:**

- Adds **semantic tags** on clusters (e.g. `crypto`, `politics`).
- Useful for:
  - Focusing relations only on certain categories.
  - UI/analysis (e.g. worst clusters by category).

**Design choice:**  
One LLM call per cluster is enough for a coarse category; we don’t need extremely fine taxonomy for Phase 1–3.

---

### 4.6 Relations

**What:** Discover **SAME_OUTCOME / OPPOSITE_OUTCOME** relations between markets **within each cluster**.

This is the **heart** of the pipeline.

#### 4.6.1 Early approach (before optimization)

- For each cluster:
  - Send the **full market list** (questions + IDs) to the LLM.
  - Ask it to propose pairs that have related outcomes.
- Problems:
  - Too many weak or noisy relations.
  - No way to say “no relation”.
  - Raw accuracy ~40–60% on evaluable pairs.

#### 4.6.2 New prompt and incentives (implemented)

We changed the relations step to be **conservative**:

- Prompt:
  - Define three relation types:
    - `SAME_OUTCOME`
    - `OPPOSITE_OUTCOME`
    - `NO_RELATION`
  - Require:
    - A **shared real-world event** (`shared_event`).
    - Clear evidence in the question text.
  - Force the model to **say NO_RELATION when unsure**:
    - Confidence `< 0.6` → treat as `NO_RELATION`.
  - Output JSON only.

- Post-parse filters:
  - Drop any item with `relation_type == "NO_RELATION"`.
  - Drop any item with `confidence < 0.6`.
  - Map `SAME_OUTCOME` → `is_same_outcome=True`, `OPPOSITE_OUTCOME` → `False`.
  - Attach `shared_event` if present.

**Why:**

- The main error mode was **over-eager relation discovery**:
  - LLM always trying to connect markets even when the evidence is weak.
- By giving it a **NO_RELATION outlet** and requiring **shared_event + evidence + confidence**, we:
  - Dramatically improved precision.
  - Reduced total number of stored relations (fewer but better).

This alone lifted raw LLM relation accuracy from ~42% to ~80+% (with outcome filter off).

#### 4.6.3 Phase 1 filters (implemented)

Phase 1 added robust pre/post filters:

1. **Cosine pre-filter (Option B):**
   - For each cluster, load embeddings from Chroma.
   - Keep only markets that have at least one neighbor in the cluster with cos_sim ≥ `relations_min_cosine_sim` (e.g. 0.35).
   - Outlier markets (far from everyone) are dropped before the LLM sees them.

2. **Time-overlap filter:**
   - When both markets have `start_time` and `end_time`, require at least some overlap or a maximum starting gap (e.g. ≤ 90 days).
   - If either market has no dates, we **allow** the pair (to avoid dropping all CSV-only entries).

3. **Outcome filter (before write):**
   - Before storing a relation:
     - If **both** markets are resolved, check:
       - `is_same_outcome=True` ↔ actual outcomes equal.
       - `False` ↔ actual outcomes opposite.
     - If the relation contradicts actual outcomes, **discard** it.
   - Config: `relations_outcome_filter` (default **True**).

4. **JSON retry/repair:**
   - On invalid JSON:
     - Apply `_repair_json` (strip markdown, extract first `{...}` etc.).
     - Retry once with a stricter “output valid JSON only” instruction.
     - Only then skip the cluster.

**Why:**

- **Cosine + time**:
  - Many pairs are obviously unrelated in embedding or time.
  - Removing those **before** LLM reduces cost and hallucination.

- **Outcome filter**:
  - We **already know** the truth for resolved markets.
  - There is no reason to store a relation that is known to be false.
  - This boosts the precision of stored relations dramatically.

- **JSON robustness**:
  - Failure to parse should not kill a cluster on first error.
  - A single retry/repair is cheap and cleans up many issues.

**Important nuance about accuracy:**

- With `relations_outcome_filter = True`:
  - Every stored **evaluable** relation already passes the outcome check.
  - So **evaluation accuracy on evaluable relations is 100% by construction**.
  - This metric becomes **“consistency of stored relations”**, not raw LLM prediction accuracy.

- To measure raw LLM accuracy, you run with:
  - `VERIBOND_RELATIONS_OUTCOME_FILTER=false` and then Evaluate.

#### 4.6.4 OpenAI embeddings and cache (Phase 2 – implemented)

Phase 2 switched from MiniLM to OpenAI embeddings (with cache and dimension handling), which:

- Improved cluster geometry (better grouping).
- Provided more stable cosine similarities.
- Gave better inputs to the cosine filters.

---

### 4.7 Evaluate

**What:** Measure how predicted relations line up with actual resolved outcomes.

**Process:**

- Read all relations and markets from SQLite.
- For each relation:
  - Look up `resolved_outcome` for `market_id_i` and `market_id_j`.
  - **Evaluable** if both are YES/NO.
  - Ground truth:
    - `same` if both YES or both NO.
    - `opposite` if one YES and one NO.
  - Prediction: `is_same_outcome` (True/False).
  - **Correct** if prediction matches ground truth.
- Metrics:
  - `total_relations`, `total_evaluable`, `total_correct`, `accuracy`.
  - Breakdown by:
    - **Cluster**
    - **Confidence bucket** (based on `confidence_score`).

**Why:**

- Gives a **hard, outcome-based metric** for semantic quality.
- Lets you compare:
  - Prompt changes.
  - Filters.
  - Embedding models.

**Key numbers from runs:**

- Older pipeline (no filters): ~42% accuracy.
- New prompt + filters, outcome filter **off**: ~83.6% accuracy.
- With outcome filter **on**: 100% **stored** relations consistent with outcomes (as expected).

---

## 5. Phase 3 – Confidence and Ranking (Current Notebook Work)

Phase 3 is about making **confidence interpretable and usable**:

> From “does the model think this is right?”  
> to “how likely is this relation to be correct?”

The **notebook `notebooks/phase3_confidence.ipynb`** does this in two sequential steps.

### 5.1 Step 1 – Add signals per relation

Using the DB and Chroma written by the pipeline:

- Load all relations (`580` total in the latest run).
- Load all markets (`173,375`).
- For each relation:
  - Fetch embeddings for `market_id_i` and `market_id_j` from Chroma.
  - Compute **cos_sim** = cosine similarity between the two embeddings.
  - Look up resolved outcomes and compute:
    - `correct = 1` if prediction matches ground truth (same/opposite).
    - `correct = 0` if mismatch.
    - NaN if either market unresolved.

Result:

- **580 relations**, **539 evaluable**, **443 correct** → **82.2% accuracy** (matches pipeline eval).
- No missing cos_sim; every relation now has:
  - `confidence_score` (LLM),
  - `cos_sim` (embedding),
  - `correct` (ground truth).

This dataset is the **input** to fusion and calibration.

### 5.2 Step 2 – Eval by bucket, fusion model, composite

#### 5.2.1 Eval by bucket (visibility)

- **By LLM confidence:**
  - `0.7–0.9`: 306 relations, 84.6% accuracy.
  - `≥0.9`: 233 relations, 79.0% accuracy.
  - → Higher LLM confidence does **not** mean higher accuracy here (miscalibration).

- **By cos_sim:**
  - `0.5–0.7`: 10, 80%.
  - `0.7–0.9`: 103, 87.4%.
  - `≥0.9`: 426, 81.0%.
  - → Mid-range cos_sim (0.7–0.9) is best; extremely high similarity is slightly worse.

This tells us:

- Both signals are somewhat informative but not perfectly calibrated.

#### 5.2.2 Fusion model: logistic regression

We treat this as a small supervised problem:

- Features: `[confidence_score, cos_sim]`.
- Target: `correct` (1 if relation is actually right, else 0) on the **539 evaluable** rows.
- Models:
  - **Model A:** LLM only.
  - **Model B:** LLM + cos_sim.
  - Evaluate on 20% holdout via **AUC**.

Results:

- Model A AUC ≈ **0.559**.
- Model B AUC ≈ **0.556**.

Interpretation:

- Both features have **weak discriminative power** for correct vs incorrect beyond “everything is ~82% good”.
- Cos_sim does **not** significantly improve AUC on this slice (that’s a real finding).

We still fit a final Model B on **all 539 evaluable** rows to get a composite formula:

`P(correct) = sigmoid(1.5793 + 0.5820 * confidence_score - 0.5730 * cos_sim)`

This gives:

- **Positive weight on LLM confidence** (more confidence → more trust).
- **Negative weight on cos_sim** (very high similarity slightly lowers trust, consistent with bucket behavior).

#### 5.2.3 Composite and calibration

Using that final model:

- Compute `composite_confidence` for all relations.
- On evaluable relations:
  - **Brier score** ≈ **0.146** (better than a constant 0.5, but not razor-sharp).
  - **ECE** ≈ **0.0** (because all composite scores fall into a single 0.7–0.9 band; no spread across buckets).
  - Accuracy by composite bucket:
    - `0.7–0.9`: 539, accuracy 82.2%.

So:

- Composite is **compressed** (one band), but:
  - It is a **data-driven** combination of LLM confidence and cos_sim.
  - It is calibrated to reproduce observed accuracy on this dataset.

This is exactly what we wanted Phase 3 to do:

- Turn raw signals into a **single, probabilistic trust score**.

---

## 6. Where We Are Now (Summary)

### 6.1 Implemented

- **Pipeline core (Reset → Ingest → Embed → Cluster → Label → Relations → Evaluate).**
- **Robust ingest and embeddings**:
  - Gamma + CSV ingest with retries.
  - OpenAI embeddings with cache and rate-limit handling.
  - Cluster quality metrics.
- **High-precision relations**:
  - Conservative prompt (NO_RELATION, shared_event, confidence ≥ 0.6).
  - Cosine and time pre-filters.
  - Outcome filter before write.
  - JSON retry/repair.
- **Evaluation**:
  - Overall accuracy and breakdown by confidence bucket.
  - Phase 3 notebook computing cos_sim per relation and analyzing calibration.
- **Phase 3 (notebook) fusion**:
  - Eval by LLM and cos_sim buckets.
  - Logistic regression P(correct | confidence_score, cos_sim).
  - `composite_confidence` and basic calibration metrics.

### 6.2 Not yet wired into pipeline (but ready to be)

- **Storing cos_sim and composite_confidence** per relation in the main DB.
- **Eval by composite bucket** in the standard evaluation step.
- **Using composite for any filtering or ranking** in the production pipeline.

Those are the next implementation tasks.

---

## 7. Why This Direction Is Right

1. **Economic alignment:**  
   The on-chain architecture makes **truth profitable** and **errors costly** – exactly what you want for AI agents.

2. **Semantic rigor:**  
   The pipeline works only on **resolved data** and checks relations against real outcomes. This gives a hard, empirical measure of semantic quality.

3. **Precision-first strategy:**  
   Filters, conservative prompts, and outcome checks intentionally trade **quantity** of relations for **quality/precision**. That’s the right trade-off before connecting to execution.

4. **Evidence-driven improvements:**  
   Each phase (prompt, filters, embeddings, composite) is:
   - Implemented behind config.
   - Measured with clear metrics (accuracy, AUC, Brier, bucket breakdown).

5. **Future-proofing:**  
   Phase 4+ (CLOB client, price history, more data) will plug into an already **measured and calibrated** semantic layer – crucial for any serious trading/backtest system.

---

## 8. How to Use This Doc

- If you want the **big picture**, read sections:
  - 1 (Problem)
  - 2 (Solution)
  - 3 (Semantic pipeline purpose)
  - 4 (Pipeline overview).

- If you want to **change or extend the pipeline**, focus on:
  - 4.6 (Relations) – where most logic and risk live.
  - 5 (Phase 3) – how we’re turning signals into trust scores.

- If you want to **plan next work**, see:
  - 6.2 (what’s not wired in yet).

