# Pipeline optimization – validation and plan

This doc reflects on your research, aligns it with the codebase, and lists what to implement.

---

## 1. Where the research is right (and we agree)

### 1.1 Root cause of ~45% accuracy

- **Agree:** Moving from single CSV to Gamma + CSV added diversity and noise; "dump cluster → LLM find relations" is under-constrained.
- **Agree:** The fix is **"system proposes → LLM judges"**, not "LLM discovers everything."

### 1.2 Embeddings: OpenAI > MiniLM

- **Agree:** Switching from `all-MiniLM-L6-v2` to OpenAI `text-embedding-3-small` or `text-embedding-3-large` is the single biggest structural upgrade. Better geometry → purer clusters → better relation candidates.
- **Caveat:** Our `embed.py` today only supports sentence-transformers (local). We need a second path: call OpenAI Embeddings API, respect dimension (1536/3072), and optionally **cache by (market_id, text_hash)** to avoid recomputing. Config already has `embedding_model`; we’ll need something like `embedding_provider: local | openai` and `embedding_dim` when using OpenAI.

### 1.3 Pre-filters before relations

- **Agree:** Filter candidate pairs before the LLM:
  - **Embedding similarity:** Only pairs with cos_sim above a threshold (e.g. 0.75). We have embeddings in Chroma; we can load by market id and compute pairwise similarity inside each cluster (or use Chroma’s “get by ids” + numpy).
  - **Time overlap:** We have `Market.start_time` and `Market.end_time` from Gamma (CSV may not). Filter: e.g. `abs(start_i - start_j) < X days` or “overlap in time.” For CSV-only markets we may have null dates → skip time filter for those or treat as “allow.”
  - **Entity/topic overlap:** Research suggests shared entities (country, person, etc.). Full NER is heavy; a cheap option is **shared significant tokens** (e.g. after lowercasing and dropping stopwords). We can do that without new deps. Optional for v1.

### 1.4 Relations prompt: conservative + NO_RELATION

- **Agree:** Current prompt effectively forces the model to output relations for many pairs. Letting the model output **NO_RELATION** and requiring a **shared real-world event** + evidence reduces hallucination.
- **Agree:** Confidence calibration: e.g. &lt; 0.6 → treat as NO_RELATION (don’t store). We can do that in code after parsing.
- **Implemented:** New prompt (see below) with SAME_OUTCOME / OPPOSITE_OUTCOME / NO_RELATION, shared_event, and strict calibration.

### 1.5 Deterministic sampling

- **Agree:** We already use `temperature=0`. Adding `top_p=0.1` (or similar) for label/relations is reasonable for consistency.

### 1.6 Outcome-based filter before storing

- **Agree:** We have resolved outcomes. Before storing a relation, check: if both markets are resolved, require that outcomes match the predicted relation type (SAME → same outcome; OPPOSITE → opposite). If they don’t match, discard. Simple and effective.

### 1.7 Composite confidence

- **Agree:** Final confidence = f(LLM confidence, embedding similarity, historical/outcome agreement) is better than raw LLM confidence. We can do: e.g. `0.4 * llm_conf + 0.3 * cos_sim + 0.3 * (1 if outcome_agrees else 0)` when we have the data. Start with LLM + cos_sim; add outcome term when we add the outcome filter.

---

## 2. Where we nuance or differ

### 2.1 Claude for relations

- **Research:** Use Claude for relations (better reasoning).
- **Our take:** Claude is strong at reasoning but often worse at strict JSON. We should:
  - **Option A:** Use Claude for relations and accept that we need **robust parsing** (allow optional fields, retry or fallback to OpenAI if JSON invalid).
  - **Option B:** Stay with OpenAI for relations first, apply the new prompt + filters + NO_RELATION, measure; then try Claude and compare.
- **Recommendation:** Implement the new prompt and filters with **OpenAI** first so we have a stable baseline; then add a **config switch** (e.g. `relations_model_provider: openai | claude`) and try Claude with the same prompt and validators.

### 2.2 Subclusters (split cluster into k=3–5)

- **Research:** Don’t do one call per cluster; split into subclusters.
- **Our take:** Good for very large clusters. We already cap `max_markets_per_cluster` (e.g. 100). Alternatives:
  - **A:** For clusters with &gt; N markets (e.g. 50), run k-means (k=3–5) on embeddings within the cluster and run relations **per subcluster** (so 3–5 LLM calls per big cluster).
  - **B:** Keep one call per cluster but **reduce context** by only sending the **pre-filtered candidate pairs** (after cos_sim + time + optional entity filter) instead of the full market list. That way the LLM only “judges” 20–80 pairs, not 100 markets.
- **Recommendation:** Start with **B** (candidate pairs only). If clusters are still too noisy, add **A** (subclusters).

### 2.3 Self-verification (second LLM pass)

- **Research:** After LLM outputs relations, run a second pass: “Is this relation logically valid? YES/NO.”
- **Our take:** Can improve precision but doubles cost and latency. Better to **first** ship: better embeddings, pre-filters, new prompt, outcome filter, composite confidence. Add verification as a **later** step if accuracy is still short of target.

### 2.4 Schema: NO_RELATION and shared_event

- **Research prompt:** Outputs `relation_type: SAME_OUTCOME | OPPOSITE_OUTCOME | NO_RELATION` and `shared_event`.
- **Our schema:** `MarketRelation` has `is_same_outcome: bool`, `rationale`, no `shared_event`. We don’t store NO_RELATION (we simply don’t emit those).
- **Plan:** Keep storing only SAME/OPPOSITE. In the prompt we ask for the three relation types; in code we **drop** any item with `relation_type == "NO_RELATION"` and map SAME → `is_same_outcome=True`, OPPOSITE → `is_same_outcome=False`. Add optional `shared_event` to `MarketRelation` (or stuff into `rationale` for now). We’ll add `shared_event` as an optional field so we can use it for display and future verification.

---

## 3. Questions for you (from the suggestions)

1. **OpenAI embeddings:** Are you okay adding an **OpenAI Embeddings API** path in `embed.py` (with config like `embedding_provider=openai`, `embedding_model=text-embedding-3-small`) and **caching** (e.g. by market_id + text hash in SQLite or a small table) so we don’t re-call on every run? Cost and latency will go up for the first run; cache makes re-runs cheap.

2. **Claude for relations:** Do you want a **configurable provider** (OpenAI vs Claude) for the relations step from the start, or should we first ship the new prompt + filters with OpenAI only and add Claude as a second step?

3. **Time overlap:** Gamma gives us `start_time` / `end_time`; CSV might not. Should we apply the time-overlap filter **only when both markets have non-null dates**, and treat “missing date” as “allow pair” (so we don’t drop all CSV-only markets)?

4. **Entity overlap:** For v1, should we add a **simple token-overlap** filter (e.g. “at least 2 shared non-stopword tokens”) or skip and rely on embedding + time only?

5. **Subclusters:** Do you want **subclustering** (k-means within cluster, then relations per subcluster) in the first optimization pass, or is “candidate pairs only” (pre-filter by cos_sim + time, then one LLM call per cluster with only those pairs) enough for now?

---

## 4. Implementation order (recommended)

| Phase | What | Why first |
|-------|------|------------|
| 1 | **New relations prompt** (NO_RELATION, shared_event, calibration) | No new infra; immediate quality gain. |
| 2 | **Pre-filters:** cos_sim threshold + time overlap (when dates exist) | Fewer, better candidates → less hallucination. |
| 3 | **Outcome filter:** Before storing, if both resolved, require outcome consistency with relation type. | Uses existing data; strong precision gain. |
| 4 | **OpenAI embeddings** (optional provider + cache) | Biggest structural upgrade; enables better clusters and cos_sim. |
| 5 | **Composite confidence** (LLM + cos_sim + outcome) | Better ranking and thresholds. |
| 6 | **Claude for relations** (optional, with fallback) | After 1–5 are stable. |
| 7 | **Self-verification** (optional second pass) | Only if accuracy still below target. |

---

## 5. What was implemented in code (this pass)

- **Relations prompt** in `relations.py` replaced with the research-style prompt:
  - System: expert analyst, conservative, NO_RELATION when unclear, no guessing.
  - User: list markets with id / question / resolved_outcome; define SAME_OUTCOME / OPPOSITE_OUTCOME / NO_RELATION; require shared real-world event and evidence; confidence &lt; 0.6 → NO_RELATION.
  - Output: JSON with `relation_type`, `shared_event`, `rationale`, `confidence`; we parse and drop NO_RELATION, map to `is_same_outcome`, and fill `question_i`/`question_j` from cluster markets.
- **MarketRelation** model: added optional `shared_event: str | None` for richer storage.
- **Post-parse:** Any relation with `relation_type == "NO_RELATION"` or `confidence < 0.6` is not stored. Stored relations get optional `shared_event` and existing required fields.

Next steps (when you confirm): pre-filters (cos_sim + time), outcome filter before write, then OpenAI embeddings path + cache.
