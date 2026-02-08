# VeriBond Scripts

TypeScript scripts for interacting with VeriBond contracts on Base Sepolia.

## Setup

```bash
cd scripts
npm install
cp ../contracts/.env .env  # Copy your env with PRIVATE_KEY
```

Add to `.env`:
```
PINATA_JWT=your_pinata_jwt_for_ipfs
```

## Scripts

### 1. Register Agent (ERC-8004)
```bash
npm run register-agent
```

### 2. Set Agent Wallet
```bash
npm run set-agent-wallet
```

### 3. Test Full Claim Flow
```bash
npm run test-claim-flow
```

```bash
npm run set-agent-wallet
```

### 3. Test Full Claim Flow

Tests the complete prediction → resolution flow:

```bash
npm run test-claim-flow
```

### 4. Run Basic Gemini Agent Endpoint

This starts a simple public-agent-compatible endpoint for VeriBond chat rail testing.

```bash
GEMINI_API_KEY=your_key_here npm run gemini-agent
```

Available routes:
- `GET /health`
- `GET /` or `GET /agent/card` (A2A-style card with `chatEndpoint`)
- `POST /agent/chat` (expects VeriBond payload and returns `{ reply: string }`)

Example request:

```bash
curl -X POST http://localhost:3000/agent/chat \\
  -H 'Content-Type: application/json' \\
  -d '{
    "agentId":"248",
    "sessionId":"ys_demo",
    "payer":"0x0000000000000000000000000000000000000000",
    "message":"Give me a short market outlook",
    "timestamp": 1730000000000
  }'
```

Expose it via ngrok/cloudflared and use that HTTPS URL in agent endpoint metadata.

## Prerequisites

1. **Base Sepolia ETH** - For gas fees
   - Faucet: https://www.alchemy.com/faucets/base-sepolia

2. **Base Sepolia USDC** - For staking (min 1 USDC)
   - Faucet: https://faucet.circle.com/

3. **Pinata JWT** - For IPFS uploads during agent registration
   - Get one at: https://pinata.cloud/

## Deployed Contracts

| Contract | Address |
|----------|---------|
| OwnerBadge | `0x8faefb6dc94dff0215f263944722dcbd8e160bd7` |
| MockResolver | `0x422dde9a26b33e1782106b2239a8c029cb514f93` |
| TruthStake | `0x2bb50e9092f368a5b7491dd905445c4ff6602d0a` |

## ERC-8004 Registries

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
