# Semantic Agent Integration in VeriBond

This doc maps **where the semantic multi-agent sits** in VeriBond and **what it must be capable of** so agents can perform the actions described in [veribond.md](../veribond.md), [README.md](../README.md), and the contracts/frontend.

---

## 1. Where the Semantic Agent Fits

From the docs, the flow is:

```
User/Agent Query  →  Semantic AI Agent  →  Claim + Stake  →  Resolution  →  Slash/Reward
                         ↑
                   (evidence retrieval,
                    clustering, relations,
                    calibrated prediction)
```

- **Contracts (TruthStake, IResolver):** Handle stake, resolve, slash. They need a **claim** (e.g. market_id + predicted outcome) and an **oracle** to resolve it.
- **Frontend:** User submits a query, sees agent prediction, stakes. It needs **evidence + prediction** from somewhere.
- **Semantic agent:** That “somewhere.” It owns:
  - **Batch pipeline:** Ingest → Embed → Cluster → Label → Relations → Evaluate (already built).
  - **Query-time:** Given a natural-language query, return **evidence** (similar markets, related pairs, cluster context) and optionally a **structured prediction** (YES/NO + confidence) that can become a claim for staking.

So the semantic agent is the **evidence + prediction brain**; contracts + frontend handle **identity, stake, resolve, and payments**.

---

## 2. What the Semantic Agent Must Be Capable Of (from docs)

| Doc / flow | Capability |
|------------|------------|
| veribond.md: “Query Submission → Agent retrieves evidence, structures claim, stakes” | **Evidence retrieval** for a user query; **structured claim** (prediction) that can be staked. |
| veribond.md: “Semantic Processing: embeddings, retrieval, evidence-based reasoning” | **Search** (embed query, similarity over markets); **clusters** and **relations** as context. |
| README: “User pays query fee → gets prediction access” | **Query API**: user sends question → backend returns evidence + prediction (and optionally market_id for resolution). |
| Paper (arXiv:2512.02436): clustering and relationship discovery | **Clusters** and **relations** (same/opposite outcome) as semantic structure; already in pipeline. |
| Contracts: Claim = agentId, claimHash, stake, predictedOutcome; Resolver resolves(claimId) | Semantic layer produces **claim payload** (e.g. market_id, question, predicted YES/NO); resolver (e.g. Polymarket adapter) resolves from market outcome. |

So the semantic agent should support:

1. **Search:** Similar markets for a free-text query (embed + Chroma).
2. **Clusters:** List clusters (with optional category); markets per cluster.
3. **Relations:** Relations for a cluster or for a market pair (same/opposite outcome).
4. **Evidence for query:** One call that returns “similar markets + related pairs + cluster labels” for an LLM or UI to form a prediction.
5. **Predict (optional):** Query → evidence → LLM → structured prediction (YES/NO, confidence, market_id) suitable for submitting as a claim.
6. **MCP:** Same capabilities as tools (search_markets, list_clusters, get_relations, get_evidence) so Cursor/other agents can use the semantic layer.

---

## 3. Current State vs Target

| Component | Current | Target |
|-----------|---------|--------|
| **Pipeline** | Ingest → Embed → Cluster → Label → Relations → Evaluate | Keep as-is; feeds DB + Chroma. |
| **Admin** | Dashboard: pipeline + upload + logs | Keep; optional “query” tab later. |
| **Query API** | Stub (`semantic_agent/api`) | Implement search, clusters, relations, evidence, optional predict. |
| **MCP** | Empty (`semantic_agent/mcp`) | MCP server with tools: search_markets, list_clusters, get_relations, get_evidence (and optionally predict). |
| **Frontend** | Placeholder (Next.js) | Call semantic API for evidence + prediction; call contracts for stake. |
| **Resolver** | MockResolver | Polymarket/UMA adapter that resolves claim using market outcome (semantic layer can supply market_id). |

---

## 4. Proposed Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VeriBond System                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Frontend (Next.js)                                                       │
│    - User enters query → GET/POST /api/evidence?q=... or /api/predict    │
│    - Shows evidence + prediction → "Stake" → TruthStake.submitClaim()    │
│    - Resolution / leaderboard from chain                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Semantic API (FastAPI, same or separate from admin)                     │
│    - GET /markets/search?q=...        (embed q, similarity in Chroma)   │
│    - GET /clusters                     (list; optional category)        │
│    - GET /clusters/{id}/markets       (markets in cluster)               │
│    - GET /relations?cluster_id=...    (relations for cluster)           │
│    - GET /evidence?q=...              (similar markets + relations +    │
│                                        cluster context for LLM)          │
│    - POST /predict                    (q → evidence → LLM → claim-like  │
│                                        { outcome, confidence, market_id })│
├─────────────────────────────────────────────────────────────────────────┤
│  Semantic Pipeline (existing)                                             │
│    - Ingest, Embed, Cluster, Label, Relations, Evaluate                 │
│    - Writes: SQLite (markets, clusters, relations) + Chroma (embeddings) │
├─────────────────────────────────────────────────────────────────────────┤
│  MCP Server (optional, same process or separate)                         │
│    - Tools: search_markets, list_clusters, get_relations, get_evidence   │
│    - Wraps same logic as Semantic API                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Contracts (Foundry)                                                      │
│    - TruthStake: submitClaim(agentId, claimHash, stake, predictedOutcome)│
│    - IResolver: resolve(claimId) → outcome (e.g. from Polymarket market)  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Frontend** talks to **Semantic API** for evidence + prediction and to **chain** for stake/resolve.
- **Resolver** (on-chain or off-chain oracle) resolves claims; semantic layer can supply **market_id** and **predicted outcome** so the resolver can fetch Polymarket result and return true/false.

---

## 5. Phased Plan

### Phase 1: Semantic Query API (read-only)

- Implement **Semantic API** (e.g. under `semantic_agent/api/` or extend admin server with `/api/v1/`):
  - `GET /markets/search?q=...&limit=20` — embed query, query Chroma, return market list.
  - `GET /clusters` — list clusters (with optional `category`).
  - `GET /clusters/{cluster_id}/markets` — markets in cluster.
  - `GET /relations?cluster_id=...` — relations for cluster (or for a market pair).
  - `GET /evidence?q=...` — combined: similar markets + relations involving those markets + cluster labels (for LLM or UI).
- Use existing store + Chroma; no new pipeline steps.
- Optional: `POST /predict` — body `{ "query": "..." }` → run evidence retrieval → LLM → return `{ "outcome": "YES"|"NO", "confidence": 0.8, "market_id": "...", "rationale": "..." }` (claim-like payload).

### Phase 2: MCP

- Implement MCP server (e.g. in `semantic_agent/mcp/`) exposing tools:
  - `search_markets(query, limit)`
  - `list_clusters(category?)`
  - `get_cluster_markets(cluster_id)`
  - `get_relations(cluster_id?)`
  - `get_evidence(query)` (and optionally `predict(query)`).
- Reuse the same service functions as the Semantic API so one implementation serves both HTTP and MCP.

### Phase 3: Frontend + contract wiring

- **Frontend:** Query box → call Semantic API (`/evidence` or `/predict`) → show evidence + prediction → “Stake” button → call TruthStake (via wagmi/viem).
- **Claim payload:** Frontend (or backend) hashes claim data (e.g. market_id + question + outcome) into `claimHash`; submits with stake and `predictedOutcome` (true/false).
- **Resolver:** Implement or adapt Polymarket (or UMA) resolver that, given claimId → claimHash/market_id, fetches market outcome and returns `resolve(claimId) → true/false`.

### Phase 4: Demo and polish

- Demo flow: historic Polymarket data → semantic evidence + prediction → stake on testnet → resolve → slash/reward.
- Leaderboard, agent stats, and Yellow/ENS as in README can follow.

---

## 6. Summary

- **Semantic agent** = evidence + prediction engine (batch pipeline already done; add **query API** + optional **predict**).
- **Contracts** = stake, resolve, slash (claim payload and market_id come from semantic layer).
- **Frontend** = user query → semantic API → show prediction → stake → resolution.
- **MCP** = same capabilities as tools for Cursor/other agents.
- **Next concrete step:** Implement Phase 1 (Semantic Query API) so “agents are capable of” retrieval, clusters, relations, and evidence (and optionally a single predict endpoint).
