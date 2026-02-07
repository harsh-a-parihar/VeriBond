'use client';

import {
    createMeeClient,
    toMultichainNexusAccount,
    getMEEVersion,
    MEEVersion,
    getMeeScanLink,
    type MeeClient,
    type MultichainSmartAccount,
} from '@biconomy/abstractjs';
import { createWalletClient, custom, http, type WalletClient } from 'viem';
import { baseSepolia } from 'viem/chains';

export interface GaslessClient {
    orchestrator: MultichainSmartAccount;
    meeClient: MeeClient;
    walletClient: WalletClient;
}

/**
 * Creates a gasless transaction client using Biconomy AbstractJS
 * This enables ERC-4337 account abstraction with sponsored gas
 */
export async function createGaslessClient(address: `0x${string}`): Promise<GaslessClient> {
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('No wallet provider found');
    }

    const walletClient = createWalletClient({
        account: address,
        chain: baseSepolia,
        transport: custom(window.ethereum),
    });

    const orchestrator = await toMultichainNexusAccount({
        chainConfigurations: [
            {
                chain: baseSepolia,
                transport: http(),
                version: getMEEVersion(MEEVersion.V2_1_0),
            },
        ],
        signer: walletClient,
    });

    const meeClient = await createMeeClient({ account: orchestrator });

    return { orchestrator, meeClient, walletClient };
}

export { getMeeScanLink };
