'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { encodeFunctionData, type Abi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createGaslessClient, getMeeScanLink, type GaslessClient } from '@/lib/biconomy';

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
}

/**
 * React hook for gasless transactions using Biconomy AbstractJS
 * Provides ERC-4337 account abstraction with sponsored gas
 */
export function useGaslessTransaction(): UseGaslessTransactionReturn {
    const { address, isConnected } = useAccount();
    const [client, setClient] = useState<GaslessClient | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [meeScanLink, setMeeScanLink] = useState<string | null>(null);

    // Initialize client when address changes
    useEffect(() => {
        if (!address || !isConnected) {
            setClient(null);
            return;
        }

        const initClient = async () => {
            try {
                const gaslessClient = await createGaslessClient(address as `0x${string}`);
                setClient(gaslessClient);
                setError(null);
            } catch (err) {
                console.error('[Gasless] Failed to init client:', err);
                setError(err instanceof Error ? err : new Error('Failed to initialize gasless client'));
                setClient(null);
            }
        };

        initClient();
    }, [address, isConnected]);

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

                // Get sponsored quote (gasless!)
                const quote = await client.meeClient.getQuote({
                    instructions: [instruction],
                    sponsorship: true, // Key: this makes it gasless
                });

                console.log('[Gasless] Quote received:', quote);

                // Execute the quote
                const { hash } = await client.meeClient.executeQuote({ quote });
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
        isReady: !!client,
        isLoading,
        error,
        meeScanLink,
    };
}
