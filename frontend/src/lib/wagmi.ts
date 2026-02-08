import { fallback, http } from 'viem';
import { baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

const rpcUrls = Array.from(
    new Set(
        [
            process.env.NEXT_PUBLIC_RPC_URL?.trim(),
            'https://sepolia.base.org',
            'https://base-sepolia-rpc.publicnode.com',
            'https://base-sepolia.gateway.tenderly.co',
        ].filter((value): value is string => !!value),
    ),
);

const baseSepoliaTransport = fallback(
    rpcUrls.map((url) =>
        http(url, {
            timeout: 12_000,
            retryCount: 2,
            retryDelay: 200,
        }),
    ),
    {
        rank: false,
    },
);

export const config = getDefaultConfig({
    appName: 'VeriBond',
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
    chains: [baseSepolia],
    transports: {
        [baseSepolia.id]: baseSepoliaTransport,
    },
    ssr: true,
});
