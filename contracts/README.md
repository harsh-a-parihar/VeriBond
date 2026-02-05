# VeriBond Contracts

Smart contracts for the VeriBond AI agent accountability protocol.

## Setup

```bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

## Build

```bash
forge build
```

## Test

```bash
forge test
```

## Structure

```
src/
├── identity/           # Owner & agent identity (ERC-8004)
│   └── OwnerBadge.sol  # Soulbound owner badge
├── staking/            # Claims and staking
│   └── TruthStake.sol  # Stake, resolve, slash
├── resolvers/          # Oracle adapters
│   └── MockResolver.sol
├── interfaces/
│   └── IResolver.sol
└── token/              # CCA/bonding curve (TBD)
```

## Dependencies

- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [Forge Std](https://github.com/foundry-rs/forge-std)
