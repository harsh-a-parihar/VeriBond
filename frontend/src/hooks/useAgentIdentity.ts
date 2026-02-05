/**
 * Agent Identity Hooks
 * 
 * Query hooks for ERC-8004 Identity Registry data
 * Based on register-direct.ts and set-agent-wallet.ts scripts
 */

import { useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS } from '@/lib/contracts';
import { IDENTITY_REGISTRY_ABI } from '@/lib/abis';

/**
 * Get agent owner from ERC-8004 registry
 */
export function useAgentOwner(agentId?: number | bigint) {
    const { data: owner, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'ownerOf',
        args: agentId !== undefined ? [BigInt(agentId)] : undefined,
        query: { enabled: agentId !== undefined }
    });

    return {
        owner: owner as `0x${string}` | undefined,
        isLoading,
        error,
        refetch,
    };
}

/**
 * Get agent wallet (the wallet authorized to make claims)
 */
export function useAgentWallet(agentId?: number | bigint) {
    const { data: wallet, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentWallet',
        args: agentId !== undefined ? [BigInt(agentId)] : undefined,
        query: { enabled: agentId !== undefined }
    });

    return {
        wallet: wallet as `0x${string}` | undefined,
        isLoading,
        error,
        refetch,
    };
}

/**
 * Get agent token URI (metadata)
 */
export function useAgentURI(agentId?: number | bigint) {
    const { data: uri, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'tokenURI',
        args: agentId !== undefined ? [BigInt(agentId)] : undefined,
        query: { enabled: agentId !== undefined }
    });

    return {
        uri: uri as string | undefined,
        isLoading,
        error,
        refetch,
    };
}

/**
 * Get number of agents owned by an address
 */
export function useAgentBalance(address?: `0x${string}`) {
    const { data: balance, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
        query: { enabled: !!address }
    });

    return {
        balance: balance as bigint | undefined,
        count: balance !== undefined ? Number(balance) : undefined,
        isLoading,
        error,
        refetch,
    };
}

/**
 * Get full agent identity info
 */
export function useAgentIdentity(agentId?: number | bigint) {
    const { data, isLoading, error, refetch } = useReadContracts({
        contracts: [
            {
                address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'ownerOf',
                args: agentId !== undefined ? [BigInt(agentId)] : undefined,
            },
            {
                address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'getAgentWallet',
                args: agentId !== undefined ? [BigInt(agentId)] : undefined,
            },
            {
                address: CONTRACTS.IDENTITY_REGISTRY as `0x${string}`,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: 'tokenURI',
                args: agentId !== undefined ? [BigInt(agentId)] : undefined,
            },
        ],
        query: { enabled: agentId !== undefined }
    });

    return {
        owner: data?.[0]?.result as `0x${string}` | undefined,
        wallet: data?.[1]?.result as `0x${string}` | undefined,
        uri: data?.[2]?.result as string | undefined,
        isLoading,
        error,
        refetch,
    };
}
