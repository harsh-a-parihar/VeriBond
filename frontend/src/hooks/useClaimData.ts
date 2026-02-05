'use client';

import { useReadContract } from 'wagmi';
import { CONTRACTS } from '@/lib/contracts';
import { TRUTH_STAKE_ABI } from '@/lib/abis';

export interface ClaimData {
    agentId: bigint;
    submitter: string;
    claimHash: `0x${string}`;
    stake: bigint;
    submittedAt: bigint;
    resolvesAt: bigint;
    predictedOutcome: boolean;
    resolved: boolean;
    wasCorrect: boolean;
}

export function useClaimDetails(claimId: `0x${string}` | undefined) {
    const { data, isLoading, error } = useReadContract({
        address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
        abi: TRUTH_STAKE_ABI,
        functionName: 'getClaim',
        args: claimId ? [claimId] : undefined,
        query: {
            enabled: !!claimId,
        },
    });

    const claim = data as ClaimData | undefined;

    return {
        claim,
        isLoading,
        error,
    };
}

export function useClaimCount() {
    const { data, isLoading, error } = useReadContract({
        address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
        abi: TRUTH_STAKE_ABI,
        functionName: 'getClaimCount',
    });

    return {
        count: data as bigint | undefined,
        isLoading,
        error,
    };
}

export function useMinStake() {
    const { data, isLoading, error } = useReadContract({
        address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
        abi: TRUTH_STAKE_ABI,
        functionName: 'minStake',
    });

    return {
        minStake: data as bigint | undefined,
        isLoading,
        error,
    };
}
