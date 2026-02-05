'use client';

import { useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS } from '@/lib/contracts';
import { TRUTH_STAKE_ABI, IDENTITY_REGISTRY_ABI } from '@/lib/abis';

export interface AgentStats {
    agentId: bigint;
    correct: bigint;
    total: bigint;
    slashed: bigint;
    accuracy: number;
    owner: string | undefined;
    agentWallet: string | undefined;
    isLoading: boolean;
    error: Error | null;
}

export function useAgentStats(agentId: number | string): AgentStats {
    const agentIdBigInt = BigInt(agentId);

    const { data: accuracyData, isLoading: loadingAccuracy, error: accuracyError } = useReadContract({
        address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
        abi: TRUTH_STAKE_ABI,
        functionName: 'getAgentAccuracy',
        args: [agentIdBigInt],
    });

    const { data: slashedData, isLoading: loadingSlashed } = useReadContract({
        address: CONTRACTS.TRUTH_STAKE as `0x${string}`,
        abi: TRUTH_STAKE_ABI,
        functionName: 'agentTotalSlashed',
        args: [agentIdBigInt],
    });

    const { data: ownerData, isLoading: loadingOwner } = useReadContract({
        address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'ownerOf',
        args: [agentIdBigInt],
    });

    const { data: walletData, isLoading: loadingWallet } = useReadContract({
        address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentWallet',
        args: [agentIdBigInt],
    });

    const correct = accuracyData?.[0] ?? BigInt(0);
    const total = accuracyData?.[1] ?? BigInt(0);
    const accuracy = total > 0 ? (Number(correct) / Number(total)) * 100 : 0;

    return {
        agentId: agentIdBigInt,
        correct,
        total,
        slashed: slashedData ?? BigInt(0),
        accuracy,
        owner: ownerData as string | undefined,
        agentWallet: walletData as string | undefined,
        isLoading: loadingAccuracy || loadingSlashed || loadingOwner || loadingWallet,
        error: accuracyError ?? null,
    };
}
