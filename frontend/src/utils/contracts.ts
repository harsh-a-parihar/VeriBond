/**
 * Contract Interaction Helpers
 * 
 * Based on test-claim-flow.ts - reusable contract interaction patterns
 */

import { CONTRACTS } from '@/lib/contracts';
import { TRUTH_STAKE_ABI, IDENTITY_REGISTRY_ABI, ERC20_ABI } from '@/lib/abis';

// Re-export contracts and ABIs for convenience
export { CONTRACTS, TRUTH_STAKE_ABI, IDENTITY_REGISTRY_ABI, ERC20_ABI };

/**
 * Extract claim ID from transaction receipt logs
 * Based on test-claim-flow.ts transaction parsing
 */
export function extractClaimIdFromReceipt(receipt: {
    logs: Array<{ address: string; topics: readonly string[] }>;
}): `0x${string}` | null {
    // Find the log from TruthStake contract
    const truthStakeLog = receipt.logs.find(log =>
        log.address.toLowerCase() === CONTRACTS.TRUTH_STAKE.toLowerCase()
    );

    if (truthStakeLog && truthStakeLog.topics[1]) {
        return truthStakeLog.topics[1] as `0x${string}`;
    }

    return null;
}

/**
 * Extract agent ID from registration receipt logs (ERC721 Transfer event)
 * Based on register-direct.ts
 */
export function extractAgentIdFromReceipt(receipt: {
    logs: Array<{ topics: readonly string[] }>;
}): bigint | null {
    // Transfer event topic: keccak256("Transfer(address,address,uint256)")
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    const transferLog = receipt.logs.find(log =>
        log.topics[0] === TRANSFER_TOPIC
    );

    if (transferLog && transferLog.topics[3]) {
        return BigInt(transferLog.topics[3]);
    }

    return null;
}

/**
 * Calculate accuracy percentage from contract data
 */
export function calculateAccuracy(correct: bigint, total: bigint): number {
    if (total === BigInt(0)) return 100;
    return (Number(correct) / Number(total)) * 100;
}

/**
 * Check if claim can be resolved (time has passed)
 */
export function canResolveClaim(resolvesAt: bigint): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now >= Number(resolvesAt);
}

/**
 * Time until claim can be resolved
 */
export function timeUntilResolution(resolvesAt: bigint): number {
    const now = Math.floor(Date.now() / 1000);
    const resolveTime = Number(resolvesAt);
    return Math.max(0, resolveTime - now);
}
