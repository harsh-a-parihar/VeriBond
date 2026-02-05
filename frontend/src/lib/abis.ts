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
        name: 'minStake',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
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
