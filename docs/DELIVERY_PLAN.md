# VeriBond – Delivery Plan (Mentor Goals)

**Mentor ask (deliver by today night):**
1. Working agent that **fetches open markets** from Polymarket (or others) and **forms relationships** between markets (from training).
2. **User can talk to the agent** and ask it to **find best trades**.
3. **Agent wallet** – agent holds funds and **executes trades by itself**.

---

## 1. Current status vs goal

| Mentor requirement | What exists now | Gap |
|--------------------|-----------------|-----|
| Fetch open markets | Gamma API + CSV ingest → SQLite. Gamma returns active + resolved markets. | We have fetch; need to **filter to “open” (active/unresolved)** if that’s the ask. CLOB has **live** order books. |
| Form relationships | Full pipeline: ingest → embed → cluster → label → **relations** (LLM finds same/opposite outcome pairs). Stored in DB. | Pipeline is there. You cleared `data/processed` – we need to **re-run pipeline** to have relations again. |
| User talks to agent, find best trades | **None.** Admin UI = pipeline control (reset, run, logs). No chat, no “best trades” logic. | Need **chat UI** + **agent backend** that queries relations + markets and returns trade suggestions. |
| Agent wallet + execute trades | **None.** No wallet, no CLOB, no order placement. | Need **wallet** (key storage, balance) + **CLOB client** (place/cancel orders). Polymarket uses CLOB API. |

**Summary:** We are **about 40% of the way** to the full ask. Data + relationships exist (after re-run). Missing: **chat agent + “best trades”**, and **wallet + execution**.

---

## 2. Why Gamma/CSV were called “not that good”

- **Not** about data being wrong: resolution audit showed Gamma ↔ DB match 100%.
- It was about **relationship (model) quality**: our LLM-generated “same/opposite outcome” relations are only ~42% correct when evaluated on resolved markets. So the **relationships** are noisy, not the **source data**.
- **For “best trades”** we also need **live prices and order books**. Gamma/CSV give markets and resolution; they don’t give real-time bid/ask. For that we need **Polymarket CLOB API** (order book, place/cancel orders).

So:
- **Keep** Gamma + CSV for: market list, questions, resolution (and training relations).
- **Add** Polymarket CLOB for: live markets, prices, and **execution**.

---

## 3. Data sources

| Source | What it gives | Use in VeriBond |
|--------|----------------|------------------|
| **Polymarket Gamma API** | Events/markets (active + resolved), resolution. | Already used. Good for “which markets exist” and relationship training. |
| **Polymarket CSV** | Bulk snapshot of markets (e.g. 100k+). | Already used. Good for offline pipeline. |
| **Polymarket CLOB API** | Live order book, prices, place/cancel orders. | **Add.** Needed for “best trades” (prices) and **agent execution**. |
| Manifold Markets API | Another prediction market. | Optional: more markets if we want cross-platform. |
| Kalshi / PredictIt | Other prediction markets. | Optional: different APIs, different liquidity. |

**Recommendation:** For “deliver by tonight,” use **Polymarket only**: Gamma + CSV (as now) + **CLOB** for live data and execution. Add other platforms later if needed.

---

## 4. Phased plan (to reach goal)

### Phase A – “Working agent” (fetch + relationships) — ~1–2 h

- **A1.** Ensure **open markets** clearly defined: e.g. “active” = not resolved, or “has liquidity” from CLOB. Prefer filtering in ingest or a simple “active_only” flag so downstream we only use open markets if needed.
- **A2.** **Re-run full pipeline** (with empty `data/processed`): Ingest (Gamma + CSV) → Embed → Cluster → Label → Relations. No need for Evaluate for delivery. Result: DB + Chroma with markets and relations.
- **A3.** Optional: add a **small CLOB fetcher** (e.g. “get markets with order book”) and merge active market IDs so “open” means “has CLOB book.” Can be minimal (e.g. one endpoint, cache in DB or memory).

**Outcome:** Agent has up-to-date markets and relationships; we can query “related pairs” from DB.

---

### Phase B – “User talks to agent / find best trades” — ~2–3 h

- **B1.** **Agent API** (FastAPI or extend admin):
  - `GET /api/agent/relations` – list related pairs (from DB), optionally by cluster or topic.
  - `GET /api/agent/markets` – list markets (open only if we have filter).
  - **Chat endpoint** `POST /api/agent/chat`: body `{ "message": "Find me the best trades" }`. Backend:
    - Uses LLM (or simple rules) to interpret intent.
    - “Best trades” → query relations + (when CLOB is wired) prices; return e.g. “Here are related pairs with high confidence and current spread…”
  - Return structured suggestions: market A, market B, relation type (same/opposite), confidence, and later: price/spread.

- **B2.** **Simple chat UI** (in existing frontend or admin):
  - One text input, “Send” button.
  - Call `POST /api/agent/chat` and show reply (and optionally “best trades” as a list/cards).

- **B3.** **“Best trades” logic (v0):**
  - No CLOB: suggest from **relations** only – e.g. “Pairs with high confidence and same/opposite outcome.”
  - With CLOB: rank by spread or liquidity (e.g. best bid/ask for related markets). Start simple: e.g. “top 10 related pairs” then later “top 10 by edge.”

**Outcome:** User can talk to the agent and get “best trades” answers (relation-based first, price-based once CLOB is in).

---

### Phase C – “Agent wallet + execute trades” — ~2–4 h (or demo)

- **C1.** **Wallet:**
  - **Option 1 (real):** Use Polymarket’s auth (private key or API key). Store key in env or secret manager; agent signs orders. **Security risk:** key management and liability.
  - **Option 2 (demo tonight):** “Simulated wallet” – balance and “orders” in DB/memory; no real chain/CLOB. Show “Agent balance: $X”, “Place order” → store as “pending” and optionally later plug in real CLOB.

- **C2.** **Execution:**
  - **Real:** CLOB client (place order, cancel order). Polymarket docs: CLOB API (place order, get order book).
  - **Demo:** “Execute” writes to DB and returns “Order placed (simulated)” with a fake order ID.

**Recommendation for tonight:** Implement **simulated wallet + simulated execution** so the flow is complete (user asks → agent suggests → agent “places trade” from “its wallet”). Add real CLOB + real key in a follow-up.

**Outcome:** User sees “agent wallet” and “agent can execute trades”; either simulated or real.

---

## 5. Priority order for tonight

1. **Phase A** – Re-run pipeline, optional “open only”/CLOB market list. **Agent has data + relations.**
2. **Phase B** – Agent API (relations, markets, chat + “best trades”) + simple chat UI. **User can talk and get trade suggestions.**
3. **Phase C** – Simulated wallet + simulated execute (or real CLOB if time). **Agent has “wallet” and “executes” trades.

If time is very tight, cut in this order: (1) real CLOB execution → do simulated; (2) CLOB for “best trades” → use only relations; (3) fancy chat UI → single input + response.

---

## 6. Technical checklist

- [ ] **Data:** Re-run ingest (Gamma + CSV) → embed → cluster → label → relations (no evaluate needed for demo).
- [ ] **Open markets:** Define “open” (e.g. active only) and filter in API or ingest.
- [ ] **Agent API:** `/api/agent/chat`, `/api/agent/relations`, `/api/agent/markets` (or under admin server).
- [ ] **Best trades (v0):** From relations DB (high confidence, optional cluster filter).
- [ ] **Chat UI:** One page with input + send + show agent reply and trade list.
- [ ] **Wallet (simulated):** Balance in config/DB; “agent balance” endpoint.
- [ ] **Execute (simulated):** “Place order” → store in DB, return success; optional “order history.”
- [ ] **Optional (if time):** Real CLOB client + real wallet (key in env), real place order.

---

## 7. Where to put new code

- **Agent API:** e.g. `admin/server/app.py` (new routes under `/api/agent/`) or a small `semantic_agent/api/agent.py` + mount in admin.
- **Chat / best-trades logic:** New module e.g. `semantic_agent/agent/` with `chat.py`, `trades.py` that read from store (relations, markets).
- **CLOB client:** `semantic_agent/fetchers/clob.py` or `semantic_agent/integrations/polymarket_clob.py`.
- **Wallet (simulated):** `semantic_agent/wallet.py` or under `agent/` – balance, place_order (write to DB).

You can start with Phase A (re-run pipeline) and Phase B (agent API + chat UI + best trades from relations) so “working agent + user talks + find best trades” is done, then add Phase C (simulated wallet + execute) to meet the full mentor ask.
