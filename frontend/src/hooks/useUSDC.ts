'use client';

import { useReadContract } from 'wagmi';
import { useAccount } from 'wagmi';
import { CONTRACTS } from '@/lib/contracts';
import { ERC20_ABI } from '@/lib/abis';

export function useUSDCBalance() {
    const { address } = useAccount();

    const { data, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
        query: {
            enabled: !!address,
        },
    });

    return {
        balance: data as bigint | undefined,
        balanceFormatted: data ? (Number(data) / 1e6).toFixed(2) : '0.00',
        isLoading,
        error,
        refetch,
    };
}

export function useUSDCAllowance(spender: string) {
    const { address } = useAccount();

    const { data, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: address ? [address, spender as `0x${string}`] : undefined,
        query: {
            enabled: !!address,
        },
    });

    return {
        allowance: data as bigint | undefined,
        isLoading,
        error,
        refetch,
    };
}
