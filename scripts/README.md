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
| OwnerBadge | `0x71e0519383D186db44921B508CCb597C9d351462` |
| MockResolver | `0x27f5A684Cb372Da83bb5F5AfD27D2c08AA5Bb6b6` |
| TruthStake | `0x266Ec894b8C29088625dD9FA2423dd110B4Fb269` |

## ERC-8004 Registries

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
