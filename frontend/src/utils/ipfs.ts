/**
 * IPFS Upload Utility
 * 
 * Based on register-direct.ts - handles metadata upload to IPFS
 * For production: use Pinata JWT from env
 * For demo: uses data URI fallback
 */

export interface AgentMetadata {
    name: string;
    description: string;
    image?: string;
    endpoints?: Array<{ type: string; value: string }>;
    trustModels?: string[];
    active?: boolean;
    updatedAt?: number;
}

/**
 * Upload agent metadata to IPFS via Pinata
 * Falls back to data URI for demo/local testing
 */
export async function uploadToIPFS(
    metadata: AgentMetadata,
    pinataJwt?: string
): Promise<string> {
    // Add default fields
    const fullMetadata = {
        ...metadata,
        image: metadata.image || 'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/Base_Symbol_Blue.png',
        endpoints: metadata.endpoints || [
            {
                type: 'A2A',
                value: 'https://veribond.example.com/.well-known/agent-card.json',
            },
        ],
        trustModels: metadata.trustModels || ['reputation', 'crypto-economic'],
        active: metadata.active ?? true,
        updatedAt: metadata.updatedAt || Math.floor(Date.now() / 1000),
    };

    // If Pinata JWT provided, upload to IPFS
    if (pinataJwt) {
        const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pinataJwt}`,
            },
            body: JSON.stringify({
                pinataContent: fullMetadata,
                pinataMetadata: {
                    name: `${metadata.name}-metadata.json`,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`Pinata upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        return `ipfs://${result.IpfsHash}`;
    }

    // Fallback: encode as data URI for demo
    const json = JSON.stringify(fullMetadata);
    const base64 = btoa(json);
    return `data:application/json;base64,${base64}`;
}

/**
 * Generate a unique claim hash from a description
 */
export function generateClaimHash(description: string): `0x${string}` {
    const timestamp = Date.now();
    const input = `${description}:${timestamp}`;
    // Create a simple hash (in production, use keccak256 from viem)
    const hex = Array.from(input)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 64)
        .padEnd(64, '0');
    return `0x${hex}` as `0x${string}`;
}

/**
 * Format USDC amount (6 decimals) to display string
 */
export function formatUSDC(amount: bigint): string {
    return (Number(amount) / 1e6).toFixed(2);
}

/**
 * Parse USDC amount from string to bigint (6 decimals)
 */
export function parseUSDC(amount: string): bigint {
    return BigInt(Math.floor(parseFloat(amount) * 1e6));
}

/**
 * Format address for display
 */
export function formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Calculate resolution timestamp
 */
export function getResolutionTimestamp(minutesFromNow: number): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + (minutesFromNow * 60));
}
