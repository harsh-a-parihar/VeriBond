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

// Base Sepolia public RPC
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';

// Biconomy STAGING/TESTNET URLs (explicitly set for browser environment)
const BICONOMY_STAGING_URL = 'https://staging-network.biconomy.io/v1';
const BICONOMY_STAGING_API_KEY = 'mee_3ZhZhHx3hmKrBQxacr283dHt';

/**
 * Creates a gasless transaction client using Biconomy AbstractJS
 * This enables ERC-4337 account abstraction with sponsored gas
 * Uses STAGING/TESTNET endpoints for Base Sepolia
 */
export async function createGaslessClient(address: `0x${string}`): Promise<GaslessClient> {
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('No wallet provider found');
    }

    console.log('[Biconomy] Creating wallet client for Base Sepolia (chain ID:', baseSepolia.id, ')');

    const walletClient = createWalletClient({
        account: address,
        chain: baseSepolia,
        transport: custom(window.ethereum),
    });

    console.log('[Biconomy] Creating multichain account with RPC:', BASE_SEPOLIA_RPC);

    const orchestrator = await toMultichainNexusAccount({
        chainConfigurations: [
            {
                chain: baseSepolia,
                transport: http(BASE_SEPOLIA_RPC),
                version: getMEEVersion(MEEVersion.V2_1_0),
            },
        ],
        signer: walletClient,
    });

    console.log('[Biconomy] Creating MEE client with STAGING URL:', BICONOMY_STAGING_URL);
    const meeClient = await createMeeClient({
        account: orchestrator,
        url: BICONOMY_STAGING_URL,
        apiKey: BICONOMY_STAGING_API_KEY,
    });

    console.log('[Biconomy] Staging client ready!');
    return { orchestrator, meeClient, walletClient };
}

// Re-export for use in other modules
export { getMeeScanLink };
