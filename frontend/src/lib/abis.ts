// TruthStake ABI
export const TRUTH_STAKE_ABI = [
    // Read functions
    {
        name: 'getClaim',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'claimId', type: 'bytes32' }],
        outputs: [{
            type: 'tuple',
            components: [
                { name: 'agentId', type: 'uint256' },
                { name: 'submitter', type: 'address' },
                { name: 'claimHash', type: 'bytes32' },
                { name: 'stake', type: 'uint256' },
                { name: 'submittedAt', type: 'uint256' },
                { name: 'resolvesAt', type: 'uint256' },
                { name: 'predictedOutcome', type: 'bool' },
                { name: 'resolved', type: 'bool' },
                { name: 'wasCorrect', type: 'bool' },
            ]
        }],
    },
    {
        name: 'getClaimCount',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'getAgentAccuracy',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [
            { name: 'correct', type: 'uint256' },
            { name: 'total', type: 'uint256' },
        ],
    },
    {
        name: 'agentTotalSlashed',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'agentRewardVault',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'minStake',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'slashPercent',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'rewardBonusBps',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'maxBonusPerClaim',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'rewardSlashBps',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint16' }],
    },
    {
        name: 'protocolSlashBps',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint16' }],
    },
    {
        name: 'marketSlashBps',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint16' }],
    },
    {
        name: 'claimIds',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'index', type: 'uint256' }],
        outputs: [{ type: 'bytes32' }],
    },
    // Write functions
    {
        name: 'submitClaim',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'claimHash', type: 'bytes32' },
            { name: 'stake', type: 'uint256' },
            { name: 'resolvesAt', type: 'uint256' },
            { name: 'predictedOutcome', type: 'bool' },
        ],
        outputs: [{ type: 'bytes32' }],
    },
    {
        name: 'resolve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'claimId', type: 'bytes32' }],
        outputs: [],
    },
    {
        name: 'fundRewardVault',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
    },
    // Events
    {
        name: 'ClaimSubmitted',
        type: 'event',
        inputs: [
            { name: 'claimId', type: 'bytes32', indexed: true },
            { name: 'agentId', type: 'uint256', indexed: true },
            { name: 'submitter', type: 'address', indexed: false },
            { name: 'claimHash', type: 'bytes32', indexed: false },
            { name: 'stake', type: 'uint256', indexed: false },
        ],
    },
    {
        name: 'ClaimResolved',
        type: 'event',
        inputs: [
            { name: 'claimId', type: 'bytes32', indexed: true },
            { name: 'agentId', type: 'uint256', indexed: true },
            { name: 'wasCorrect', type: 'bool', indexed: false },
            { name: 'slashAmount', type: 'uint256', indexed: false },
            { name: 'bonusAmount', type: 'uint256', indexed: false },
        ],
    },
] as const;

// Identity Registry ABI
export const IDENTITY_REGISTRY_ABI = [
    {
        name: 'register',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'agentURI', type: 'string' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'setAgentWallet',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'wallet', type: 'address' },
        ],
        outputs: [],
    },
    {
        name: 'ownerOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ type: 'address' }],
    },
    {
        name: 'getAgentWallet',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ type: 'address' }],
    },
    {
        name: 'tokenURI',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ type: 'string' }],
    },
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
] as const;

// ERC20 (USDC) ABI
export const ERC20_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint8' }],
    },
] as const;

// OwnerBadge ABI (Soulbound token for owner accountability)
export const OWNER_BADGE_ABI = [
    // Read functions
    {
        name: 'hasBadge',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'isBlacklisted',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'ownerToBadge',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'slashCount',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'badgeId', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'getBadgeId',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
    // Write functions
    {
        name: 'mint',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [],
        outputs: [],
    },
] as const;

// Agent Token Factory ABI
export const AGENT_TOKEN_FACTORY_ABI = [
    {
        name: 'launchAuction',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'name', type: 'string' },
            { name: 'symbol', type: 'string' },
            { name: 'tokensForSale', type: 'uint256' },
            { name: 'startPrice', type: 'uint256' },
            { name: 'minPrice', type: 'uint256' },
            { name: 'durationBlocks', type: 'uint256' },
            { name: 'tickSpacing', type: 'uint256' },
            { name: 'auctionStepsData', type: 'bytes' },
        ],
        outputs: [],
    },
    {
        name: 'getAgentAuction',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ type: 'address' }],
    },
    {
        name: 'getAgentToken',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{ type: 'address' }],
    },
    {
        name: 'liquidityManager',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'address' }],
    },
    {
        name: 'lpReserveBps',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint16' }],
    },
] as const;

export const POST_AUCTION_LIQUIDITY_MANAGER_ABI = [
    {
        name: 'finalizeAuction',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'auction', type: 'address' }],
        outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    },
    {
        name: 'releaseLiquidityAssets',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'auction', type: 'address' },
            { name: 'recipient', type: 'address' },
            { name: 'tokenAmount', type: 'uint256' },
        ],
        outputs: [],
    },
    {
        name: 'auctions',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'auction', type: 'address' }],
        outputs: [
            { name: 'agentId', type: 'uint256' },
            { name: 'agentOwner', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'currency', type: 'address' },
            { name: 'lpReserveTokens', type: 'uint256' },
            { name: 'currencyRaised', type: 'uint256' },
            { name: 'lpCurrencyBudget', type: 'uint256' },
            { name: 'lpTokenBudget', type: 'uint256' },
            { name: 'registered', type: 'bool' },
            { name: 'finalized', type: 'bool' },
            { name: 'liquidityAssetsReleased', type: 'bool' },
        ],
    },
] as const;

// Continuous Clearing Auction (CCA) ABI
export const CCA_ABI = [
    {
        name: 'clearingPrice',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'totalCleared',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'floorPrice',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'tickSpacing',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'MAX_BID_PRICE',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'claimBlock',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint64' }],
    },
    {
        // 4-arg version (used by reference implementation)
        name: 'submitBid',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: '_maxPrice', type: 'uint256' },
            { name: '_amount', type: 'uint128' },
            { name: '_owner', type: 'address' },
            { name: '_hookData', type: 'bytes' },
        ],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'exitBid',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: '_bidId', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'claimTokens',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: '_bidId', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'claimTokensBatch',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: '_owner', type: 'address' },
            { name: '_bidIds', type: 'uint256[]' },
        ],
        outputs: [],
    },
    // Event for tracking bid IDs
    {
        name: 'BidSubmitted',
        type: 'event',
        inputs: [
            { name: 'bidId', type: 'uint256', indexed: true },
            { name: 'owner', type: 'address', indexed: true },
            { name: 'maxPrice', type: 'uint256', indexed: false },
            { name: 'amount', type: 'uint128', indexed: false },
        ],
    },
    {
        name: 'BidExited',
        type: 'event',
        inputs: [
            { name: 'bidId', type: 'uint256', indexed: true },
            { name: 'owner', type: 'address', indexed: true },
            { name: 'tokensFilled', type: 'uint256', indexed: false },
            { name: 'currencyRefunded', type: 'uint256', indexed: false },
        ],
    },
] as const;
