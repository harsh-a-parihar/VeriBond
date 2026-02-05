/**
 * Mock Resolver Hooks
 * 
 * Query hooks for MockResolver contract (admin can set outcomes)
 * Based on test-claim-flow.ts script
 */

import { useReadContract } from 'wagmi';
import { CONTRACTS } from '@/lib/contracts';

// MockResolver ABI
const MOCK_RESOLVER_ABI = [
    {
        name: 'canResolve',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'claimId', type: 'bytes32' }],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'getOutcome',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'claimId', type: 'bytes32' }],
        outputs: [{ type: 'bool' }],
    },
    {
        name: 'setOutcome',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'claimId', type: 'bytes32' },
            { name: 'outcome', type: 'bool' },
        ],
        outputs: [],
    },
] as const;

export { MOCK_RESOLVER_ABI };

/**
 * Check if a claim can be resolved (oracle has set outcome)
 */
export function useCanResolve(claimId?: `0x${string}`) {
    const { data: canResolve, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.MOCK_RESOLVER as `0x${string}`,
        abi: MOCK_RESOLVER_ABI,
        functionName: 'canResolve',
        args: claimId ? [claimId] : undefined,
        query: { enabled: !!claimId }
    });

    return {
        canResolve: canResolve as boolean | undefined,
        isLoading,
        error,
        refetch,
    };
}
