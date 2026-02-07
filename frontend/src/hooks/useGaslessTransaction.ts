'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { type Abi } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
    createGaslessClient,
    getMeeScanLink,
    type GaslessClient,
} from '@/lib/biconomy';

// USDC on Base Sepolia (supports permit for gasless)
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

export interface GaslessTransactionParams {
    to: `0x${string}`;
    abi: Abi;
    functionName: string;
    args: unknown[];
    value?: bigint;
}

export interface UseGaslessTransactionReturn {
    sendGasless: (params: GaslessTransactionParams) => Promise<string>;
    isReady: boolean;
    isLoading: boolean;
    error: Error | null;
    meeScanLink: string | null;
    isWrongNetwork: boolean;
    switchToBaseSepolia: () => void;
}

/**
 * React hook for gasless transactions using Biconomy AbstractJS
 * Uses Fusion mode for external wallets (MetaMask, etc.)
 * Provides ERC-4337 account abstraction with sponsored gas
 */
export function useGaslessTransaction(): UseGaslessTransactionReturn {
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const { switchChain } = useSwitchChain();
    const [client, setClient] = useState<GaslessClient | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [meeScanLink, setMeeScanLink] = useState<string | null>(null);

    // Check if on correct network
    const isWrongNetwork = chainId !== baseSepolia.id;

    const switchToBaseSepolia = useCallback(() => {
        switchChain({ chainId: baseSepolia.id });
    }, [switchChain]);

    // Initialize client when address changes AND on correct network
    useEffect(() => {
        if (!address || !isConnected || isWrongNetwork) {
            setClient(null);
            return;
        }

        const initClient = async () => {
            try {
                console.log('[Gasless] Initializing Fusion client for chain:', chainId);
                const gaslessClient = await createGaslessClient(address as `0x${string}`);
                setClient(gaslessClient);
                setError(null);
                console.log('[Gasless] Fusion client initialized successfully');
            } catch (err) {
                console.error('[Gasless] Failed to init client:', err);
                setError(err instanceof Error ? err : new Error('Failed to initialize gasless client'));
                setClient(null);
            }
        };

        initClient();
    }, [address, isConnected, isWrongNetwork, chainId]);

    const sendGasless = useCallback(
        async (params: GaslessTransactionParams): Promise<string> => {
            if (!client) {
                throw new Error('Gasless client not initialized');
            }

            setIsLoading(true);
            setError(null);
            setMeeScanLink(null);

            try {
                // Build the composable instruction
                const instruction = await client.orchestrator.buildComposable({
                    type: 'default',
                    data: {
                        abi: params.abi,
                        chainId: baseSepolia.id,
                        to: params.to,
                        functionName: params.functionName,
                        args: params.args,
                        value: params.value,
                    },
                });

                console.log('[Gasless] Instruction built:', instruction);

                // Use Fusion Quote for external wallets (MetaMask)
                // With sponsorship:true, the gas is sponsored and no trigger funds are needed
                const fusionQuote = await client.meeClient.getFusionQuote({
                    instructions: [instruction],
                    sponsorship: true, // Gas is sponsored - truly gasless!
                    trigger: {
                        chainId: baseSepolia.id,
                        tokenAddress: USDC_BASE_SEPOLIA,
                        amount: 1n, // Minimal amount for trigger signature (sponsored)
                    },
                });

                console.log('[Gasless] Fusion quote received:', fusionQuote);

                // Execute the fusion quote
                const { hash } = await client.meeClient.executeFusionQuote({ fusionQuote });
                console.log('[Gasless] Transaction hash:', hash);

                // Generate MEE scan link
                const link = getMeeScanLink(hash);
                setMeeScanLink(link);

                // Wait for completion
                await client.meeClient.waitForSupertransactionReceipt({ hash });
                console.log('[Gasless] Transaction confirmed!');

                setIsLoading(false);
                return hash;
            } catch (err) {
                console.error('[Gasless] Transaction failed:', err);
                const error = err instanceof Error ? err : new Error('Gasless transaction failed');
                setError(error);
                setIsLoading(false);
                throw error;
            }
        },
        [client]
    );

    return {
        sendGasless,
        isReady: !!client && !isWrongNetwork,
        isLoading,
        error,
        meeScanLink,
        isWrongNetwork,
        switchToBaseSepolia,
    };
}

