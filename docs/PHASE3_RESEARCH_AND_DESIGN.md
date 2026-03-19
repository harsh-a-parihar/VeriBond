# Phase 3: Research Objectives and Design

This doc captures **what we want to achieve and find out** before implementing Phase 3 (composite confidence + eval by bucket), plus answers from the literature and a minimal experiment design.

---

## 1. What we want to achieve (research goals)

**Core question:**  
Given (LLM confidence, cosine similarity, maybe time), **what is the probability that a relation is actually correct?**

If we can answer that, we can:
- Rank relations by trust
- Set thresholds for “only act when P(correct) > X”
- Use Phase 4 (execution) safely

**Deliverables from research:**

| # | Deliverable | Why |
|---|-------------|-----|
| 1 | **Decision: learn weights vs fix them** | Drives whether we fit a small model or hand-tune w1, w2, w3. |
| 2 | **Choice of fusion model** | E.g. logistic regression vs linear combo; validated by literature. |
| 3 | **Calibration metric** | How we measure “does 0.8 mean 80% correct?” (reliability diagram, ECE, Brier). |
| 4 | **Threshold strategy** | How we set “only trade when composite ≥ X” (cost-sensitive, TunedThresholdClassifierCV, etc.). |
| 5 | **Feature ablation** | Evidence: does LLM+cos beat LLM alone? Does adding time help? (AUC / calibration by model). |

---

## 2. Five research questions and what the literature says

### Q1: Should we learn weights or fix them?

**Answer: Learn them.**

- Combining multiple signals is standard **score fusion**; weights are typically **learned** via maximum likelihood (e.g. logistic regression) or risk-bound criteria, not fixed by hand.
- Additive logistic regression and “combining biomarker models” literature: weights are learned from data to optimize likelihood or decision risk.
- **Implication:** Fit a small model (e.g. logistic regression) on `(llm_conf, cos_sim)` with labels `y = correct (1/0)` on resolved relations. Use the learned coefficients as w1, w2 (and later w3 for time if we add it).

### Q2: Which fusion model is enough?

**Answer: Logistic regression is sufficient and well-justified.**

- Linear combination on the **logit scale** (logistic regression) is the standard way to fuse binary outcomes from multiple signals.
- It gives a proper probability: P(correct | x) = sigmoid(w·x). No need for boosting or trees in v1.
- **Implication:** Use `sklearn.linear_model.LogisticRegression` (or similar) on features `[llm_conf, cos_sim]` and optionally `time_score`. Output is directly interpretable as P(correct).

### Q3: How do we measure calibration?

**Answer: Use reliability diagrams plus a scalar metric (ECE or Brier).**

- **Reliability diagram:** Plot predicted probability (bucketed) vs actual frequency of correct. Well-calibrated = points on the diagonal.
- **Platt scaling:** If raw scores are miscalibrated, fit a sigmoid (Platt) on a held-out set to map score → probability. We’re already using logistic regression, so our composite *is* a probability model; we mainly need to **evaluate** calibration.
- **Metrics:**
  - **Brier score:** (1/N) Σ(pred_prob - outcome)². Lower is better; strictly proper.
  - **ECE (Expected Calibration Error):** Average gap between predicted confidence and empirical accuracy in bins. Standard for summarizing miscalibration.
- **Implication:** After fitting composite = P(correct | llm, cos), plot reliability diagram and report Brier and ECE. Use bucket accuracy (eval by confidence bucket) as the operational view.

### Q4: How do we set trading thresholds?

**Answer: Separate “predict probability” from “decide when to act”.**

- Default 0.5 is rarely optimal. Threshold should depend on **cost of false positives vs false negatives** (e.g. cost of a bad trade vs cost of missing a good one).
- **Approaches:** (1) Manual threshold for “only trade when P(correct) > 0.7”; (2) `TunedThresholdClassifierCV` (or equivalent) to optimize a metric (e.g. precision at fixed recall, or custom cost) on validation data.
- **Implication:** First iteration: **do not filter by composite**; only compute and store composite, and report eval by composite bucket. Once we see the distribution and calibration, choose a threshold (or tune it) for Phase 4.

### Q5: When does adding a feature help?

**Answer: Ablation: train and evaluate (AUC, calibration) for (LLM only), (LLM + cos), (LLM + cos + time).**

- Compare AUC and calibration (e.g. ECE, Brier) across models. If adding cosine improves AUC and calibration, keep it; if time adds little or hurts (e.g. missing data, noise), drop it for v1.
- **Implication:** Plan a small experiment: build three models (LLM only; LLM+cos; LLM+cos+time), compare AUC and reliability. Decide feature set before locking Phase 3 formula.

---

## 3. Minimal experiment design (after research)

**Dataset (from current eval):**

- For each **evaluable** relation (both markets resolved): `(llm_conf, cos_sim, time_score?, y)`.
- `y = 1` if relation is correct (predicted SAME/OPPOSITE matches ground truth), `y = 0` otherwise.
- We do **not** have `cos_sim` per relation yet; Phase 3 implementation must compute and store it (or we run a one-off script that loads relations, fetches embeddings from Chroma, computes cosine, and exports a table for this experiment).

**Steps:**

1. **Get cos_sim per relation** (one-off or as part of Phase 3): For each stored relation, load embeddings for `market_id_i`, `market_id_j` from Chroma; compute cosine. If missing, use NaN or 0 and flag.
2. **Build time_score (optional):** For each relation, if both markets have `start_time`/`end_time`, compute overlap/gap and map to [0, 1]. Else leave as NaN or neutral.
3. **Train three models (no time for v1 is fine):**
   - Model A: `P(y \| llm_conf)` — logistic regression on 1 feature.
   - Model B: `P(y \| llm_conf, cos_sim)` — logistic regression on 2 features.
   - Model C (optional): `P(y \| llm_conf, cos_sim, time_score)` — 3 features.
4. **Evaluate:** AUC-ROC, Brier score, ECE (or similar), and **accuracy by predicted-probability bucket** (e.g. 0.6–0.7, 0.7–0.8, 0.8+).
5. **Decide:** Use Model B (or C) coefficients as composite weights. Store composite as P(correct). Do not filter by composite in v1; only log and report buckets. Set threshold later for Phase 4.

**Practical note:** With ~312 evaluable relations, keep the model simple (no heavy regularization or many features) to avoid overfitting. Cross-validation or a single train/validation split is enough.

---

## 4. Refined Phase 3 plan (conceptual)

Aligned with “be careful before moving forward” and “learn weights, don’t filter early”:

| Step | What | Why |
|------|------|-----|
| **1. Add signals** | Store `cos_sim` per relation (compute at write time from Chroma). Keep `confidence_score` (LLM). | We need cos_sim to fit composite and to report eval by cosine bucket. |
| **2. Eval by bucket (visibility)** | Log and report accuracy per **LLM confidence** bucket and (once we have it) per **cosine** bucket. | See “does confidence mean anything?” and where we’re strongest. |
| **3. Fit fusion model (offline)** | On resolved relations, fit logistic regression: `P(correct \| llm_conf, cos_sim)`. | Data-driven weights; no hand-tuned 0.5/0.3/0.2. |
| **4. Compute and store composite** | `composite_confidence = P(correct \| x)` from fitted model. Store in DB; keep `confidence_score`. | Single ranking score for downstream. |
| **5. Calibrate and then threshold** | Report calibration (reliability, ECE, Brier) and accuracy by **composite** bucket. Only then decide `relations_min_composite` for Phase 4. | Avoid over-filtering and biased learning. |

**Out of scope for v1:** Time in composite (add later if ablation shows benefit). Outcome filter stays separate (supervision), not baked into composite.

---

## 5. What to do next

1. **You (research):** Skim score fusion + calibration (links above); optional: run the minimal experiment on a CSV export of (llm_conf, cos_sim, y) once cos_sim is available (e.g. after Step 1).
2. **Implementation (after you’re satisfied):** Implement Phase 3 in this order: (1) add and store cos_sim per relation + eval-by-bucket logging, (2) add script or pipeline step to fit logistic regression on resolved relations and export weights, (3) add composite_confidence to schema and write path using fitted weights, (4) report eval by composite bucket and calibration metrics.
3. **Threshold:** Leave `relations_min_composite` unset or disabled until we have composite distribution and calibration; then set for Phase 4.

---

## 6. References (short)

- Score fusion / combining signals: additive logistic regression, combining biomarker models in logistic regression; learn weights via MLE.
- Calibration: Platt scaling (sigmoid correction); reliability diagrams; Brier score; ECE (expected calibration error).
- Thresholds: cost-sensitive learning; `TunedThresholdClassifierCV` (sklearn); set threshold by cost/benefit, not default 0.5.
- Ablation: compare AUC and calibration for LLM only vs LLM+cos vs LLM+cos+time to decide feature set.
